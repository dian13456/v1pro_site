package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	ImageReviewStatusPending  = "pending"
	ImageReviewStatusApproved = "approved"
	ImageReviewStatusRejected = "rejected"

	ReviewActionShareAI     = "share_ai"
	ReviewActionShareUser   = "share_user"
	ReviewActionShareUserGif = "share_user_gif"
	ReviewActionTransfer    = "transfer"
	ReviewActionGenerate    = "generate"
)

type PendingImageReview struct {
	ID             string `json:"id"`
	Serial         string `json:"serial"`
	Author         string `json:"author,omitempty"`
	Action         string `json:"action"`
	Title          string `json:"title,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
	Description    string `json:"description,omitempty"`
	Source         string `json:"source,omitempty"`
	ImageObjectKey string `json:"imageObjectKey"`
	GifObjectKey   string `json:"gifObjectKey,omitempty"`
	CoverObjectKey string `json:"coverObjectKey,omitempty"`
	Label          string `json:"label,omitempty"`
	SubLabel       string `json:"subLabel,omitempty"`
	Score          int    `json:"score,omitempty"`
	Status         string `json:"status"`
	ReviewNote     string `json:"reviewNote,omitempty"`
	CreatedAt      string `json:"createdAt"`
	ReviewedAt     string `json:"reviewedAt,omitempty"`
}

type ImageReviewStore struct {
	Items []PendingImageReview `json:"items"`
}

func LoadImageReviewStore(path string) (ImageReviewStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ImageReviewStore{Items: []PendingImageReview{}}, nil
		}
		return ImageReviewStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return ImageReviewStore{Items: []PendingImageReview{}}, nil
	}
	var store ImageReviewStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return ImageReviewStore{}, err
	}
	if store.Items == nil {
		store.Items = []PendingImageReview{}
	}
	return store, nil
}

func SaveImageReviewStore(path string, store ImageReviewStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Items == nil {
		store.Items = []PendingImageReview{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func (store *ImageReviewStore) Enqueue(item PendingImageReview) PendingImageReview {
	if store.Items == nil {
		store.Items = []PendingImageReview{}
	}
	item.ID = strings.TrimSpace(item.ID)
	if item.ID == "" {
		item.ID = fmt.Sprintf("rev-%d", time.Now().UnixNano())
	}
	item.Status = ImageReviewStatusPending
	if strings.TrimSpace(item.CreatedAt) == "" {
		item.CreatedAt = time.Now().Format(time.RFC3339)
	}
	store.Items = append([]PendingImageReview{item}, store.Items...)
	return item
}

func (store *ImageReviewStore) Find(id string) (PendingImageReview, int, bool) {
	id = strings.TrimSpace(id)
	for idx, item := range store.Items {
		if item.ID == id {
			return item, idx, true
		}
	}
	return PendingImageReview{}, -1, false
}

func (store *ImageReviewStore) List(status string) []PendingImageReview {
	status = strings.TrimSpace(strings.ToLower(status))
	result := make([]PendingImageReview, 0, len(store.Items))
	for _, item := range store.Items {
		if status == "" || status == "all" || strings.EqualFold(item.Status, status) {
			result = append(result, item)
		}
	}
	return result
}

func (store *ImageReviewStore) Update(id string, updater func(*PendingImageReview) error) (PendingImageReview, error) {
	item, idx, ok := store.Find(id)
	if !ok {
		return PendingImageReview{}, fmt.Errorf("复核记录不存在")
	}
	if err := updater(&item); err != nil {
		return PendingImageReview{}, err
	}
	store.Items[idx] = item
	return item, nil
}

func ReviewPendingObjectKey(reviewID string) string {
	safeID := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(strings.TrimSpace(reviewID))
	return fmt.Sprintf("review_pending/%s.jpg", safeID)
}

func StageImageForReview(
	ctx context.Context,
	signer *COSSigner,
	reviewID string,
	imageBase64 string,
) (string, error) {
	if signer == nil {
		return "", fmt.Errorf("图片存储未配置")
	}
	raw, err := DecodeAIImageBytes(imageBase64)
	if err != nil {
		return "", err
	}
	objectKey := ReviewPendingObjectKey(reviewID)
	if err := signer.UploadObject(ctx, objectKey, "image/jpeg", raw); err != nil {
		return "", fmt.Errorf("保存待审图片失败: %w", err)
	}
	return objectKey, nil
}

type EnqueueImageReviewInput struct {
	Serial      string
	Author      string
	Action      string
	Title       string
	Prompt      string
	Description string
	Source      string
	ImageBase64 string
	Outcome     ImageModerationOutcome
}

func EnqueueImageReview(
	ctx context.Context,
	signer *COSSigner,
	store *ImageReviewStore,
	input EnqueueImageReviewInput,
) (PendingImageReview, error) {
	reviewID := fmt.Sprintf("rev-%d", time.Now().UnixNano())
	objectKey, err := StageImageForReview(ctx, signer, reviewID, input.ImageBase64)
	if err != nil {
		return PendingImageReview{}, err
	}
	item := store.Enqueue(PendingImageReview{
		ID:             reviewID,
		Serial:         strings.TrimSpace(input.Serial),
		Author:         strings.TrimSpace(input.Author),
		Action:         strings.TrimSpace(input.Action),
		Title:          strings.TrimSpace(input.Title),
		Prompt:         strings.TrimSpace(input.Prompt),
		Description:    strings.TrimSpace(input.Description),
		Source:         strings.TrimSpace(input.Source),
		ImageObjectKey: objectKey,
		Label:          strings.TrimSpace(input.Outcome.Label),
		SubLabel:       strings.TrimSpace(input.Outcome.SubLabel),
		Score:          input.Outcome.Score,
	})
	return item, nil
}

func ApprovePendingImageReview(
	ctx context.Context,
	signer *COSSigner,
	imagePublicBase string,
	resourcesPath string,
	imageMapPath string,
	store *ImageReviewStore,
	reviewID string,
	note string,
) (*ShareAIImageResult, error) {
	return ApprovePendingReview(ctx, CatalogPublishDeps{
		ImageSigner:     signer,
		ImagePublicBase: imagePublicBase,
		ResourcesPath:   resourcesPath,
		ImageMapPath:    imageMapPath,
	}, store, reviewID, note)
}

type CatalogPublishDeps struct {
	ImageSigner     *COSSigner
	ImagePublicBase string
	ResourcesPath   string
	ImageMapPath    string
	ResourceMapPath string
}

func ApprovePendingReview(
	ctx context.Context,
	deps CatalogPublishDeps,
	store *ImageReviewStore,
	reviewID string,
	note string,
) (*ShareAIImageResult, error) {
	item, _, ok := store.Find(reviewID)
	if !ok {
		return nil, fmt.Errorf("复核记录不存在")
	}
	if !strings.EqualFold(item.Status, ImageReviewStatusPending) {
		return nil, fmt.Errorf("该记录已处理")
	}

	var result *ShareAIImageResult
	var err error

	switch item.Action {
	case ReviewActionShareAI, ReviewActionShareUser:
		if deps.ImageSigner == nil {
			return nil, fmt.Errorf("图片存储未配置")
		}
		result, err = approvePendingImageShare(ctx, deps, store, item, reviewID, note)
	case ReviewActionShareUserGif:
		if strings.TrimSpace(deps.ResourceMapPath) == "" {
			return nil, fmt.Errorf("素材映射未配置")
		}
		result, err = approvePendingGifShare(deps, item, reviewID, note, store)
	default:
		return nil, fmt.Errorf("该类型记录不支持发布到素材库")
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

func approvePendingImageShare(
	ctx context.Context,
	deps CatalogPublishDeps,
	store *ImageReviewStore,
	item PendingImageReview,
	reviewID string,
	note string,
) (*ShareAIImageResult, error) {
	signedURL, err := deps.ImageSigner.GenerateReadURL(ctx, item.ImageObjectKey, 30*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("读取待审图片失败")
	}
	imageBase64, err := fetchURLAsBase64DataURL(ctx, signedURL)
	if err != nil {
		return nil, err
	}

	prompt := item.Prompt
	title := item.Title
	if item.Action == ReviewActionShareUser {
		if prompt == "" {
			prompt = item.Description
		}
		if title == "" {
			title = item.Description
		}
	}

	result, err := ShareAIImageToCatalog(
		ctx,
		deps.ImageSigner,
		deps.ImagePublicBase,
		deps.ResourcesPath,
		deps.ImageMapPath,
		ShareAIImageInput{
			ImageBase64:    imageBase64,
			Prompt:         prompt,
			Title:          title,
			Author:         item.Author,
			UploaderSerial: item.Serial,
		},
	)
	if err != nil {
		return nil, err
	}

	_, err = store.Update(reviewID, func(entry *PendingImageReview) error {
		entry.Status = ImageReviewStatusApproved
		entry.ReviewNote = strings.TrimSpace(note)
		entry.ReviewedAt = time.Now().Format(time.RFC3339)
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, nil
}

func approvePendingGifShare(
	deps CatalogPublishDeps,
	item PendingImageReview,
	reviewID string,
	note string,
	store *ImageReviewStore,
) (*ShareAIImageResult, error) {
	gifObjectKey := strings.TrimSpace(item.GifObjectKey)
	coverObjectKey := strings.TrimSpace(item.CoverObjectKey)
	if gifObjectKey == "" {
		gifObjectKey = strings.TrimSpace(item.ImageObjectKey)
	}
	if coverObjectKey == "" {
		coverObjectKey = strings.TrimSpace(item.ImageObjectKey)
	}
	if gifObjectKey == "" || coverObjectKey == "" {
		return nil, fmt.Errorf("待审 GIF 信息不完整")
	}

	title := item.Title
	description := item.Description
	if title == "" {
		title = item.Description
	}
	if description == "" {
		description = item.Title
	}

	result, err := ShareUserGifToCatalog(
		deps.ResourcesPath,
		deps.ResourceMapPath,
		deps.ImageMapPath,
		ShareUserGifInput{
			Title:          title,
			Description:    description,
			Author:         item.Author,
			UploaderSerial: item.Serial,
			GifObjectKey:   gifObjectKey,
			CoverObjectKey: coverObjectKey,
			GifSizeBytes:   0,
		},
	)
	if err != nil {
		return nil, err
	}

	_, err = store.Update(reviewID, func(entry *PendingImageReview) error {
		entry.Status = ImageReviewStatusApproved
		entry.ReviewNote = strings.TrimSpace(note)
		entry.ReviewedAt = time.Now().Format(time.RFC3339)
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, nil
}

func RejectPendingImageReview(store *ImageReviewStore, reviewID string, note string) (PendingImageReview, error) {
	return store.Update(reviewID, func(entry *PendingImageReview) error {
		if !strings.EqualFold(entry.Status, ImageReviewStatusPending) {
			return fmt.Errorf("该记录已处理")
		}
		entry.Status = ImageReviewStatusRejected
		entry.ReviewNote = strings.TrimSpace(note)
		entry.ReviewedAt = time.Now().Format(time.RFC3339)
		return nil
	})
}

func ProcessImageModerationWithReview(
	ctx context.Context,
	imsClient *ImageModerationClient,
	signer *COSSigner,
	store *ImageReviewStore,
	input EnqueueImageReviewInput,
	dataID string,
	moderationType string,
) (PendingImageReview, bool, error) {
	outcome, err := imsClient.ModerateImageBase64Detailed(ctx, input.ImageBase64, dataID, moderationType)
	if err != nil {
		return PendingImageReview{}, false, err
	}
	switch outcome.Suggestion {
	case "PASS", "":
		return PendingImageReview{}, false, nil
	case "REVIEW":
		if store == nil {
			return PendingImageReview{}, false, fmt.Errorf("%w: %s", ErrImageModerationReview, formatModerationMessage(outcome, "图片需人工复核，暂无法上传"))
		}
		input.Outcome = outcome
		item, err := EnqueueImageReview(ctx, signer, store, input)
		if err != nil {
			return PendingImageReview{}, false, err
		}
		return item, true, nil
	default:
		return PendingImageReview{}, false, fmt.Errorf("%w: %s", ErrImageModerationBlocked, formatModerationMessage(outcome, "图片未通过内容安全审核"))
	}
}

type EnqueueGifReviewInput struct {
	Serial         string
	Author         string
	Title          string
	Description    string
	GifObjectKey   string
	CoverObjectKey string
	Outcome        ImageModerationOutcome
}

func EnqueueGifReview(store *ImageReviewStore, input EnqueueGifReviewInput) PendingImageReview {
	reviewID := fmt.Sprintf("rev-%d", time.Now().UnixNano())
	coverObjectKey := strings.TrimSpace(input.CoverObjectKey)
	return store.Enqueue(PendingImageReview{
		ID:             reviewID,
		Serial:         strings.TrimSpace(input.Serial),
		Author:         strings.TrimSpace(input.Author),
		Action:         ReviewActionShareUserGif,
		Title:          strings.TrimSpace(input.Title),
		Description:    strings.TrimSpace(input.Description),
		Source:         "upload",
		ImageObjectKey: coverObjectKey,
		GifObjectKey:   strings.TrimSpace(input.GifObjectKey),
		CoverObjectKey: coverObjectKey,
		Label:          strings.TrimSpace(input.Outcome.Label),
		SubLabel:       strings.TrimSpace(input.Outcome.SubLabel),
		Score:          input.Outcome.Score,
	})
}

func ProcessGifShareModerationWithReview(
	ctx context.Context,
	imsClient *ImageModerationClient,
	gifSigner *COSSigner,
	coverSigner *COSSigner,
	store *ImageReviewStore,
	input EnqueueGifReviewInput,
	dataID string,
) (PendingImageReview, bool, error) {
	if imsClient == nil || !imsClient.Available() {
		return PendingImageReview{}, false, nil
	}

	coverBytes, err := FetchObjectBytes(ctx, coverSigner, input.CoverObjectKey, maxIMSFileBytes)
	if err != nil {
		return PendingImageReview{}, false, fmt.Errorf("读取 GIF 封面失败")
	}
	coverOutcome, err := imsClient.ModerateImageBytesDetailed(ctx, coverBytes, dataID+"-cover", "IMAGE")
	if err != nil {
		return PendingImageReview{}, false, err
	}

	gifOutcome, err := imsClient.ModerateGifObjectDetailed(ctx, gifSigner, input.GifObjectKey, dataID+"-gif")
	if err != nil {
		return PendingImageReview{}, false, err
	}

	outcome := strictestModerationOutcome(coverOutcome, gifOutcome)
	return applyGifModerationOutcome(store, input, outcome)
}

func fetchURLAsBase64DataURL(ctx context.Context, url string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("下载待审图片失败: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxIMSFileBytes))
	if err != nil {
		return "", err
	}
	if len(body) == 0 {
		return "", fmt.Errorf("待审图片为空")
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(body), nil
}

func encodeJPEGDataURL(body []byte) string {
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(body)
}
