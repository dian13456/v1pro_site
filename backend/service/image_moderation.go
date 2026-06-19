package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	tcerr "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	ims "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/ims/v20201229"
)

const (
	defaultIMSRegion     = "ap-guangzhou"
	maxIMSFileBytes      = 10 << 20
	defaultGifInterval   = int64(5)
	defaultGifMaxFrames  = int64(5)
	imsRequestTimeoutSec = 30
)

type GifModerationConfig struct {
	Interval  int64
	MaxFrames int64
}

func DefaultGifModerationConfig() GifModerationConfig {
	return GifModerationConfig{
		Interval:  defaultGifInterval,
		MaxFrames: defaultGifMaxFrames,
	}
}

func ParseGifModerationConfig(intervalRaw, maxFramesRaw string) GifModerationConfig {
	cfg := DefaultGifModerationConfig()
	if intervalRaw = strings.TrimSpace(intervalRaw); intervalRaw != "" {
		if value, err := parsePositiveInt64(intervalRaw); err == nil {
			cfg.Interval = value
		}
	}
	if maxFramesRaw = strings.TrimSpace(maxFramesRaw); maxFramesRaw != "" {
		if value, err := parsePositiveInt64(maxFramesRaw); err == nil {
			cfg.MaxFrames = value
		}
	}
	return cfg
}

func parsePositiveInt64(raw string) (int64, error) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("invalid int64: %q", raw)
	}
	return value, nil
}

var (
	ErrImageModerationBlocked = errors.New("image moderation blocked")
	ErrImageModerationReview  = errors.New("image moderation review")
)

type ImageModerationOutcome struct {
	Suggestion string
	Label      string
	SubLabel   string
	Score      int
}

type ImageModerationClient struct {
	SecretID      string
	SecretKey     string
	Region        string
	BizType       string
	Enabled       bool
	GifModeration GifModerationConfig
	client        *ims.Client
}

func NewImageModerationClient(
	secretID, secretKey, region, bizType string,
	enabled bool,
	gifModeration GifModerationConfig,
) (*ImageModerationClient, error) {
	secretID = strings.TrimSpace(secretID)
	secretKey = strings.TrimSpace(secretKey)
	region = strings.TrimSpace(region)
	if region == "" {
		region = defaultIMSRegion
	}
	bizType = strings.TrimSpace(bizType)

	client := &ImageModerationClient{
		SecretID:      secretID,
		SecretKey:     secretKey,
		Region:        region,
		BizType:       bizType,
		Enabled:       enabled,
		GifModeration: gifModeration,
	}
	if !enabled || secretID == "" || secretKey == "" {
		return client, nil
	}

	credential := common.NewCredential(secretID, secretKey)
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "ims.tencentcloudapi.com"
	cpf.HttpProfile.ReqTimeout = imsRequestTimeoutSec

	imsClient, err := ims.NewClient(credential, region, cpf)
	if err != nil {
		return nil, fmt.Errorf("init ims client failed: %w", err)
	}
	client.client = imsClient
	return client, nil
}

func (client *ImageModerationClient) Available() bool {
	return client != nil && client.Enabled && client.SecretID != "" && client.SecretKey != "" && client.client != nil
}

func (client *ImageModerationClient) ModerateImageBase64(
	ctx context.Context,
	imageBase64 string,
	dataID string,
	moderationType string,
) error {
	outcome, err := client.ModerateImageBase64Detailed(ctx, imageBase64, dataID, moderationType)
	if err != nil {
		return err
	}
	return outcomeToError(outcome)
}

func (client *ImageModerationClient) ModerateImageBase64Detailed(
	ctx context.Context,
	imageBase64 string,
	dataID string,
	moderationType string,
) (ImageModerationOutcome, error) {
	raw, err := DecodeAIImageBytes(imageBase64)
	if err != nil {
		return ImageModerationOutcome{}, err
	}
	return client.ModerateImageBytesDetailed(ctx, raw, dataID, moderationType)
}

func (client *ImageModerationClient) ModerateImageBytes(
	ctx context.Context,
	raw []byte,
	dataID string,
	moderationType string,
) error {
	outcome, err := client.ModerateImageBytesDetailed(ctx, raw, dataID, moderationType)
	if err != nil {
		return err
	}
	return outcomeToError(outcome)
}

func (client *ImageModerationClient) ModerateImageBytesDetailed(
	ctx context.Context,
	raw []byte,
	dataID string,
	moderationType string,
) (ImageModerationOutcome, error) {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if !client.Available() {
		return outcome, nil
	}
	if len(raw) < 16 {
		return outcome, fmt.Errorf("图片文件过小，无法审核")
	}
	if len(raw) > maxIMSFileBytes {
		return outcome, fmt.Errorf("图片过大，无法审核（最大 10MB）")
	}

	moderationType = strings.TrimSpace(moderationType)
	if moderationType == "" {
		moderationType = "IMAGE"
	}
	return client.callImageModeration(ctx, imsModerationRequest{
		dataID:         sanitizeIMSDataID(dataID),
		moderationType: moderationType,
		fileContent:    raw,
	})
}

// ModerateGifObjectDetailed runs Tencent IMS frame sampling on the full GIF object in COS.
func (client *ImageModerationClient) ModerateGifObjectDetailed(
	ctx context.Context,
	gifSigner *COSSigner,
	objectKey string,
	dataID string,
) (ImageModerationOutcome, error) {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if !client.Available() {
		return outcome, nil
	}
	if gifSigner == nil {
		return outcome, fmt.Errorf("GIF 存储未配置")
	}
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return outcome, fmt.Errorf("GIF 路径无效")
	}

	head, err := gifSigner.HeadObject(ctx, objectKey)
	if err != nil {
		return outcome, fmt.Errorf("读取 GIF 文件信息失败")
	}
	if head.ContentLength <= 0 {
		return outcome, fmt.Errorf("GIF 文件为空")
	}
	if head.ContentLength > MaxUserGifUploadBytes {
		return outcome, fmt.Errorf("GIF 文件超过大小限制")
	}

	req := imsModerationRequest{
		dataID:         sanitizeIMSDataID(dataID),
		moderationType: "IMAGE",
		interval:       client.GifModeration.Interval,
		maxFrames:      client.GifModeration.MaxFrames,
	}
	if head.ContentLength <= maxIMSFileBytes {
		raw, fetchErr := FetchObjectBytes(ctx, gifSigner, objectKey, maxIMSFileBytes)
		if fetchErr != nil {
			return outcome, fmt.Errorf("读取 GIF 文件失败")
		}
		req.fileContent = raw
		return client.callImageModeration(ctx, req)
	}

	signedURL, urlErr := gifSigner.GenerateReadURL(ctx, objectKey, 10*time.Minute)
	if urlErr != nil {
		return outcome, fmt.Errorf("生成 GIF 审核地址失败")
	}
	req.fileURL = signedURL
	return client.callImageModeration(ctx, req)
}

type imsModerationRequest struct {
	dataID         string
	moderationType string
	fileContent    []byte
	fileURL        string
	interval       int64
	maxFrames      int64
}

func (client *ImageModerationClient) callImageModeration(
	ctx context.Context,
	input imsModerationRequest,
) (ImageModerationOutcome, error) {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return outcome, ctx.Err()
	default:
	}

	request := ims.NewImageModerationRequest()
	if client.BizType != "" {
		request.BizType = common.StringPtr(client.BizType)
	}
	request.DataId = common.StringPtr(input.dataID)
	request.Type = common.StringPtr(input.moderationType)
	if input.fileURL != "" {
		request.FileUrl = common.StringPtr(input.fileURL)
	} else {
		request.FileContent = common.StringPtr(base64.StdEncoding.EncodeToString(input.fileContent))
	}
	if input.maxFrames > 0 {
		request.Interval = common.Int64Ptr(input.interval)
		request.MaxFrames = common.Int64Ptr(input.maxFrames)
	}

	response, err := client.client.ImageModerationWithContext(ctx, request)
	if err != nil {
		if sdkErr, ok := err.(*tcerr.TencentCloudSDKError); ok {
			return outcome, mapIMSError(sdkErr)
		}
		return outcome, fmt.Errorf("图片审核失败: %w", err)
	}
	if response == nil || response.Response == nil {
		return outcome, fmt.Errorf("图片审核失败: 空响应")
	}

	outcome.Suggestion = strings.ToUpper(strings.TrimSpace(stringValue(response.Response.Suggestion)))
	outcome.Label = strings.TrimSpace(stringValue(response.Response.Label))
	outcome.SubLabel = strings.TrimSpace(stringValue(response.Response.SubLabel))
	if response.Response.Score != nil {
		outcome.Score = int(*response.Response.Score)
	}
	if outcome.Suggestion == "" {
		outcome.Suggestion = "PASS"
	}
	return outcome, nil
}

func moderationSuggestionRank(suggestion string) int {
	switch strings.ToUpper(strings.TrimSpace(suggestion)) {
	case "PASS", "":
		return 1
	case "REVIEW":
		return 2
	default:
		return 3
	}
}

func strictestModerationOutcome(items ...ImageModerationOutcome) ImageModerationOutcome {
	best := ImageModerationOutcome{Suggestion: "PASS"}
	bestRank := 1
	for _, item := range items {
		item.Suggestion = strings.ToUpper(strings.TrimSpace(item.Suggestion))
		if item.Suggestion == "" {
			item.Suggestion = "PASS"
		}
		rank := moderationSuggestionRank(item.Suggestion)
		if rank > bestRank || (rank == bestRank && rank > 1 && item.Score > best.Score) {
			best = item
			bestRank = rank
		}
	}
	return best
}

func applyGifModerationOutcome(
	store *ImageReviewStore,
	input EnqueueGifReviewInput,
	outcome ImageModerationOutcome,
) (PendingImageReview, bool, error) {
	switch outcome.Suggestion {
	case "PASS", "":
		return PendingImageReview{}, false, nil
	case "REVIEW":
		if store == nil {
			return PendingImageReview{}, false, fmt.Errorf(
				"%w: %s",
				ErrImageModerationReview,
				formatModerationMessage(outcome, "GIF 需人工复核，暂无法上传"),
			)
		}
		input.Outcome = outcome
		item := EnqueueGifReview(store, input)
		return item, true, nil
	default:
		return PendingImageReview{}, false, fmt.Errorf(
			"%w: %s",
			ErrImageModerationBlocked,
			formatModerationMessage(outcome, "GIF 未通过内容安全审核"),
		)
	}
}

func outcomeToError(outcome ImageModerationOutcome) error {
	switch outcome.Suggestion {
	case "PASS", "":
		return nil
	case "REVIEW":
		return fmt.Errorf("%w: %s", ErrImageModerationReview, formatModerationMessage(outcome, "图片需人工复核，暂无法上传"))
	default:
		return fmt.Errorf("%w: %s", ErrImageModerationBlocked, formatModerationMessage(outcome, "图片未通过内容安全审核"))
	}
}

func formatModerationMessage(outcome ImageModerationOutcome, fallback string) string {
	parts := make([]string, 0, 2)
	if outcome.Label != "" && !strings.EqualFold(outcome.Label, "Normal") {
		parts = append(parts, outcome.Label)
	}
	if outcome.SubLabel != "" {
		parts = append(parts, outcome.SubLabel)
	}
	if len(parts) > 0 {
		return fmt.Sprintf("%s（%s）", fallback, strings.Join(parts, " / "))
	}
	return fallback
}

func stringValue(raw *string) string {
	if raw == nil {
		return ""
	}
	return *raw
}

func sanitizeIMSDataID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Sprintf("img-%d", time.Now().UnixNano())
	}
	if len(raw) > 64 {
		return raw[:64]
	}
	return raw
}

func mapIMSError(err *tcerr.TencentCloudSDKError) error {
	code := strings.TrimSpace(err.GetCode())
	message := strings.TrimSpace(err.GetMessage())
	switch code {
	case "UnauthorizedOperation", "UnauthorizedOperation.Unauthorized":
		return fmt.Errorf("图片审核服务未开通或账号欠费")
	case "InvalidParameterValue.InvalidFileContentSize", "InvalidParameterValue.InvalidImageContent":
		return fmt.Errorf("图片格式或大小不符合审核要求")
	case "ResourceUnavailable.ImageDownloadError":
		return fmt.Errorf("图片审核下载失败，请稍后重试")
	case "RequestLimitExceeded":
		return fmt.Errorf("图片审核请求过于频繁，请稍后重试")
	default:
		if message != "" {
			return fmt.Errorf("图片审核失败: %s", message)
		}
		return fmt.Errorf("图片审核失败")
	}
}

func IsImageModerationRejected(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrImageModerationBlocked) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "内容安全审核") ||
		strings.Contains(msg, "审核服务未开通")
}

func IsImageModerationReview(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrImageModerationReview) || strings.Contains(err.Error(), "人工复核")
}
