package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func FilterCatalogByUploaderSerial(items []map[string]any, serial string) []map[string]any {
	target := normalizeUploaderSerial(serial)
	if target == "" || len(items) == 0 {
		return nil
	}
	result := make([]map[string]any, 0)
	for _, item := range items {
		if item == nil {
			continue
		}
		uploader := normalizeUploaderSerial(stringifyCatalogValue(item[catalogUploaderSerialKey]))
		if uploader != target {
			continue
		}
		result = append(result, item)
	}
	return result
}

func reviewActionMaterialType(action string) string {
	switch strings.TrimSpace(action) {
	case ReviewActionShareUserGif:
		return "gif"
	case ReviewActionShareUserVideo:
		return "video"
	default:
		return "image"
	}
}

func reviewPreviewObjectKey(item PendingImageReview) string {
	materialType := reviewActionMaterialType(item.Action)
	if materialType == "gif" || materialType == "video" {
		if key := strings.TrimSpace(item.CoverObjectKey); key != "" {
			return key
		}
	}
	return strings.TrimSpace(item.ImageObjectKey)
}

func normalizeReviewUploadTitle(item PendingImageReview) string {
	title := strings.TrimSpace(item.Title)
	if title != "" {
		return title
	}
	description := strings.TrimSpace(item.Description)
	if description != "" {
		return description
	}
	switch reviewActionMaterialType(item.Action) {
	case "gif":
		return "GIF 上传"
	case "video":
		return "视频上传"
	default:
		if strings.TrimSpace(item.Source) == "upload" {
			return "图片上传"
		}
		return "AI 分享"
	}
}

func isShareReviewAction(action string) bool {
	switch strings.TrimSpace(action) {
	case ReviewActionShareAI, ReviewActionShareUser, ReviewActionShareUserGif, ReviewActionShareUserVideo:
		return true
	default:
		return false
	}
}

// ListDeviceUploadReviews returns pending/rejected share reviews for one device.
func ListDeviceUploadReviews(store *ImageReviewStore, serial string) []map[string]any {
	target := normalizeUploaderSerial(serial)
	if target == "" || store == nil || len(store.Items) == 0 {
		return nil
	}
	result := make([]map[string]any, 0)
	for _, item := range store.Items {
		if normalizeUploaderSerial(item.Serial) != target {
			continue
		}
		if !isShareReviewAction(item.Action) {
			continue
		}
		status := strings.TrimSpace(strings.ToLower(item.Status))
		if status != ImageReviewStatusPending && status != ImageReviewStatusRejected {
			continue
		}
		materialType := reviewActionMaterialType(item.Action)
		entry := map[string]any{
			"reviewId":     item.ID,
			"status":       status,
			"title":        normalizeReviewUploadTitle(item),
			"description":  strings.TrimSpace(item.Description),
			"materialType": materialType,
			"category":     "gif",
			"image":        reviewPreviewObjectKey(item),
			"createdAt":    strings.TrimSpace(item.CreatedAt),
			"author":       strings.TrimSpace(item.Author),
		}
		if note := strings.TrimSpace(item.ReviewNote); note != "" {
			entry["reviewNote"] = note
		}
		if columnTag := strings.TrimSpace(item.ColumnTag); columnTag != "" {
			entry["columnTag"] = columnTag
		}
		result = append(result, entry)
	}
	sortUploadEntriesByTime(result, "createdAt")
	return result
}

func sortUploadEntriesByTime(items []map[string]any, timeKey string) {
	if len(items) < 2 {
		return
	}
	for i := 0; i < len(items)-1; i++ {
		for j := i + 1; j < len(items); j++ {
			left := parseUploadEntryTime(items[i], timeKey)
			right := parseUploadEntryTime(items[j], timeKey)
			if left.Before(right) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func parseUploadEntryTime(item map[string]any, timeKey string) time.Time {
	if item == nil {
		return time.Time{}
	}
	raw := stringifyCatalogValue(item[timeKey])
	if raw == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func SortCatalogByUpdatedAtDesc(items []map[string]any) {
	sortUploadEntriesByTime(items, "updatedAt")
}

type ReviewPreviewSigners struct {
	Image      *COSSigner
	GifCover   *COSSigner
	VideoCover *COSSigner
}

func ResolveReviewPreviewSigner(item PendingImageReview, signers ReviewPreviewSigners) (*COSSigner, string) {
	objectKey := reviewPreviewObjectKey(item)
	if objectKey == "" {
		return nil, ""
	}
	switch strings.TrimSpace(item.Action) {
	case ReviewActionShareUserGif:
		if signers.GifCover != nil {
			return signers.GifCover, objectKey
		}
	case ReviewActionShareUserVideo:
		if signers.VideoCover != nil {
			return signers.VideoCover, objectKey
		}
	}
	if signers.Image != nil {
		return signers.Image, objectKey
	}
	return nil, objectKey
}

func AttachReviewPreviewURLs(
	ctx context.Context,
	entries []map[string]any,
	store *ImageReviewStore,
	serial string,
	signers ReviewPreviewSigners,
) {
	if len(entries) == 0 || store == nil {
		return
	}
	target := normalizeUploaderSerial(serial)
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		reviewID := strings.TrimSpace(stringifyCatalogValue(entry["reviewId"]))
		if reviewID == "" {
			continue
		}
		item, _, ok := store.Find(reviewID)
		if !ok || normalizeUploaderSerial(item.Serial) != target {
			continue
		}
		signer, objectKey := ResolveReviewPreviewSigner(item, signers)
		if signer == nil || objectKey == "" {
			continue
		}
		signedURL, err := signer.GenerateReadURL(ctx, objectKey, 30*time.Minute)
		if err != nil {
			continue
		}
		entry["previewUrl"] = signedURL
	}
}

type UploadDeleteSigners struct {
	Image      *COSSigner
	Gif        *COSSigner
	Video      *COSSigner
	GifCover   *COSSigner
	VideoCover *COSSigner
}

type DeleteOwnPublishedUploadInput struct {
	Serial          string
	ResourceID      int64
	ResourcesPath   string
	ResourceMapPath string
	ImageMapPath    string
	Signers         UploadDeleteSigners
}

func findCatalogEntryByID(resources []map[string]any, resourceID int64) (map[string]any, int, bool) {
	idText := strconv.FormatInt(resourceID, 10)
	for idx, item := range resources {
		if item == nil {
			continue
		}
		if stringifyCatalogID(item["id"]) == idText {
			return item, idx, true
		}
	}
	return nil, -1, false
}

func catalogEntryOwnedBySerial(entry map[string]any, serial string) bool {
	if entry == nil {
		return false
	}
	uploader := normalizeUploaderSerial(stringifyCatalogValue(entry[catalogUploaderSerialKey]))
	target := normalizeUploaderSerial(serial)
	return uploader != "" && uploader == target
}

func tryDeleteObject(ctx context.Context, signer *COSSigner, objectKey string) {
	if signer == nil {
		return
	}
	objectKey = StripPublicObjectURL(objectKey)
	if objectKey == "" {
		return
	}
	_ = signer.DeleteObject(ctx, objectKey)
}

func deletePublishedCatalogObjects(
	ctx context.Context,
	entry map[string]any,
	resourceMap map[string]string,
	imageMap map[string]string,
	idKey string,
	signers UploadDeleteSigners,
) {
	materialType := strings.ToLower(stringifyCatalogValue(entry["materialType"]))
	downloadKey := strings.TrimSpace(resourceMap[idKey])
	if downloadKey == "" {
		downloadKey = StripPublicObjectURL(stringifyCatalogValue(entry["download"]))
	}
	imageKey := strings.TrimSpace(imageMap[idKey])
	if imageKey == "" {
		imageKey = StripPublicObjectURL(stringifyCatalogValue(entry["image"]))
	}
	switch materialType {
	case "gif":
		tryDeleteObject(ctx, signers.Gif, downloadKey)
		tryDeleteObject(ctx, signers.GifCover, imageKey)
	case "video":
		tryDeleteObject(ctx, signers.Video, downloadKey)
		tryDeleteObject(ctx, signers.VideoCover, imageKey)
	default:
		tryDeleteObject(ctx, signers.Image, downloadKey)
		if imageKey != "" && imageKey != downloadKey {
			tryDeleteObject(ctx, signers.Image, imageKey)
		}
	}
}

func DeleteOwnPublishedUpload(ctx context.Context, input DeleteOwnPublishedUploadInput) error {
	serial := normalizeUploaderSerial(input.Serial)
	if serial == "" {
		return fmt.Errorf("设备 SN 无效")
	}
	if input.ResourceID <= 0 {
		return fmt.Errorf("素材编号无效")
	}

	aiImageShareMu.Lock()
	defer aiImageShareMu.Unlock()

	resources, err := loadResourceCatalogFile(input.ResourcesPath)
	if err != nil {
		return fmt.Errorf("读取素材清单失败")
	}
	entry, idx, ok := findCatalogEntryByID(resources, input.ResourceID)
	if !ok {
		return fmt.Errorf("素材不存在")
	}
	if !catalogEntryOwnedBySerial(entry, serial) {
		return fmt.Errorf("无权删除该素材")
	}

	resourceMap, err := loadStringMapFile(input.ResourceMapPath)
	if err != nil {
		return fmt.Errorf("读取素材映射失败")
	}
	imageMap, err := loadStringMapFile(input.ImageMapPath)
	if err != nil {
		return fmt.Errorf("读取封面映射失败")
	}

	idKey := strconv.FormatInt(input.ResourceID, 10)
	deletePublishedCatalogObjects(ctx, entry, resourceMap, imageMap, idKey, input.Signers)
	delete(resourceMap, idKey)
	delete(imageMap, idKey)
	resources = append(resources[:idx], resources[idx+1:]...)

	if err := saveResourceCatalogFile(input.ResourcesPath, resources); err != nil {
		return fmt.Errorf("保存素材清单失败")
	}
	if err := saveStringMapFile(input.ResourceMapPath, resourceMap); err != nil {
		return fmt.Errorf("保存素材映射失败")
	}
	if err := saveStringMapFile(input.ImageMapPath, imageMap); err != nil {
		return fmt.Errorf("保存封面映射失败")
	}
	return nil
}

func deleteReviewObjects(ctx context.Context, item PendingImageReview, signers UploadDeleteSigners) {
	switch strings.TrimSpace(item.Action) {
	case ReviewActionShareUserGif:
		tryDeleteObject(ctx, signers.Gif, item.GifObjectKey)
		tryDeleteObject(ctx, signers.GifCover, item.CoverObjectKey)
	case ReviewActionShareUserVideo:
		tryDeleteObject(ctx, signers.Video, item.GifObjectKey)
		tryDeleteObject(ctx, signers.VideoCover, item.CoverObjectKey)
	default:
		tryDeleteObject(ctx, signers.Image, item.ImageObjectKey)
	}
}

func RemoveDeviceReviewUpload(store *ImageReviewStore, reviewID, serial string) (PendingImageReview, error) {
	target := normalizeUploaderSerial(serial)
	if target == "" {
		return PendingImageReview{}, fmt.Errorf("设备 SN 无效")
	}
	reviewID = strings.TrimSpace(reviewID)
	if reviewID == "" {
		return PendingImageReview{}, fmt.Errorf("复核编号无效")
	}
	if store == nil {
		return PendingImageReview{}, fmt.Errorf("复核队列未配置")
	}

	item, idx, ok := store.Find(reviewID)
	if !ok {
		return PendingImageReview{}, fmt.Errorf("上传记录不存在")
	}
	if normalizeUploaderSerial(item.Serial) != target {
		return PendingImageReview{}, fmt.Errorf("无权删除该素材")
	}
	if !isShareReviewAction(item.Action) {
		return PendingImageReview{}, fmt.Errorf("该记录不可删除")
	}
	status := strings.TrimSpace(strings.ToLower(item.Status))
	if status != ImageReviewStatusPending && status != ImageReviewStatusRejected {
		return PendingImageReview{}, fmt.Errorf("当前状态不可删除")
	}
	store.Items = append(store.Items[:idx], store.Items[idx+1:]...)
	return item, nil
}

func DeleteOwnReviewUpload(
	ctx context.Context,
	store *ImageReviewStore,
	reviewID string,
	serial string,
	signers UploadDeleteSigners,
) error {
	item, err := RemoveDeviceReviewUpload(store, reviewID, serial)
	if err != nil {
		return err
	}
	deleteReviewObjects(ctx, item, signers)
	return nil
}
