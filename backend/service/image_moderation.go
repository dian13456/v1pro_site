package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	tcerr "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	ims "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/ims/v20201229"
)

const (
	defaultIMSRegion = "ap-guangzhou"
	maxIMSFileBytes  = 10 << 20
)

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
	SecretID  string
	SecretKey string
	Region    string
	BizType   string
	Enabled   bool
	client    *ims.Client
}

func NewImageModerationClient(secretID, secretKey, region, bizType string, enabled bool) (*ImageModerationClient, error) {
	secretID = strings.TrimSpace(secretID)
	secretKey = strings.TrimSpace(secretKey)
	region = strings.TrimSpace(region)
	if region == "" {
		region = defaultIMSRegion
	}
	bizType = strings.TrimSpace(bizType)

	client := &ImageModerationClient{
		SecretID:  secretID,
		SecretKey: secretKey,
		Region:    region,
		BizType:   bizType,
		Enabled:   enabled,
	}
	if !client.Available() {
		return client, nil
	}

	credential := common.NewCredential(secretID, secretKey)
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "ims.tencentcloudapi.com"
	cpf.HttpProfile.ReqTimeout = 15

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
	dataID = sanitizeIMSDataID(dataID)

	request := ims.NewImageModerationRequest()
	if client.BizType != "" {
		request.BizType = common.StringPtr(client.BizType)
	}
	request.DataId = common.StringPtr(dataID)
	request.FileContent = common.StringPtr(base64.StdEncoding.EncodeToString(raw))
	request.Type = common.StringPtr(moderationType)

	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return outcome, ctx.Err()
	default:
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
