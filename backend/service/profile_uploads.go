package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxUploadTitleRunes = 80

func ValidateUploadTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" {
		return "", fmt.Errorf("素材标题不能为空")
	}
	if utf8.RuneCountInString(title) > maxUploadTitleRunes {
		return "", fmt.Errorf("素材标题不能超过 %d 个字符", maxUploadTitleRunes)
	}
	return title, nil
}

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
		uploader := catalogUploaderSerialValue(item)
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

func UpdateOwnPublishedUploadTitle(serial string, resourceID int64, rawTitle, resourcesPath string) error {
	target := normalizeUploaderSerial(serial)
	if target == "" {
		return fmt.Errorf("设备 SN 无效")
	}
	if resourceID <= 0 {
		return fmt.Errorf("素材编号无效")
	}
	title, err := ValidateUploadTitle(rawTitle)
	if err != nil {
		return err
	}

	aiImageShareMu.Lock()
	defer aiImageShareMu.Unlock()
	resources, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		return fmt.Errorf("读取素材清单失败")
	}
	entry, _, ok := findCatalogEntryByID(resources, resourceID)
	if !ok {
		return fmt.Errorf("素材不存在")
	}
	if !catalogEntryOwnedBySerial(entry, target) {
		return fmt.Errorf("无权修改该素材")
	}
	entry["title"] = title
	entry["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	if err := saveResourceCatalogFile(resourcesPath, resources); err != nil {
		return fmt.Errorf("保存素材清单失败")
	}
	return nil
}

func UpdateOwnReviewUploadTitle(store *ImageReviewStore, reviewID, serial, rawTitle string) error {
	target := normalizeUploaderSerial(serial)
	if target == "" {
		return fmt.Errorf("设备 SN 无效")
	}
	title, err := ValidateUploadTitle(rawTitle)
	if err != nil {
		return err
	}
	if store == nil {
		return fmt.Errorf("复核队列未配置")
	}
	item, idx, ok := store.Find(strings.TrimSpace(reviewID))
	if !ok {
		return fmt.Errorf("上传记录不存在")
	}
	if normalizeUploaderSerial(item.Serial) != target {
		return fmt.Errorf("无权修改该素材")
	}
	if !isShareReviewAction(item.Action) {
		return fmt.Errorf("该记录不可修改")
	}
	status := strings.TrimSpace(strings.ToLower(item.Status))
	if status != ImageReviewStatusPending && status != ImageReviewStatusRejected {
		return fmt.Errorf("该记录不可修改")
	}
	store.Items[idx].Title = title
	return nil
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

type COSObjectDeleter interface {
	DeleteObject(context.Context, string) error
}

type UploadDeleteSigners struct {
	Image      COSObjectDeleter
	Gif        COSObjectDeleter
	Video      COSObjectDeleter
	GifCover   COSObjectDeleter
	VideoCover COSObjectDeleter
}

type DeleteOwnPublishedUploadInput struct {
	Serial          string
	ResourceID      int64
	ResourcesPath   string
	ResourceMapPath string
	ImageMapPath    string
	Signers         UploadDeleteSigners
	AllowAnyOwner   bool
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

// FindCatalogEntryByID returns one catalog entry by resource id.
func FindCatalogEntryByID(resources []map[string]any, resourceID int64) (map[string]any, int, bool) {
	return findCatalogEntryByID(resources, resourceID)
}

// LoadPublishedUploadSnapshot reads catalog entry and maps before deleting a published upload.
func LoadPublishedUploadSnapshot(
	resourcesPath, resourceMapPath, imageMapPath string,
	resourceID int64,
) (entry map[string]any, resourceMap map[string]string, imageMap map[string]string, idKey string, ok bool) {
	if resourceID <= 0 {
		return nil, nil, nil, "", false
	}
	resources, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		return nil, nil, nil, "", false
	}
	entry, _, ok = findCatalogEntryByID(resources, resourceID)
	if !ok {
		return nil, nil, nil, "", false
	}
	resourceMap, err = loadStringMapFile(resourceMapPath)
	if err != nil {
		return nil, nil, nil, "", false
	}
	imageMap, err = loadStringMapFile(imageMapPath)
	if err != nil {
		return nil, nil, nil, "", false
	}
	return entry, resourceMap, imageMap, strconv.FormatInt(resourceID, 10), true
}

func catalogEntryOwnedBySerial(entry map[string]any, serial string) bool {
	if entry == nil {
		return false
	}
	uploader := catalogUploaderSerialValue(entry)
	target := normalizeUploaderSerial(serial)
	return uploader != "" && uploader == target
}

// PublishedUploadUploaderSerial returns the private owner key from a catalog
// snapshot. It is used only by trusted server-side cleanup paths.
func PublishedUploadUploaderSerial(entry map[string]any) string {
	if entry == nil {
		return ""
	}
	return catalogUploaderSerialValue(entry)
}

func tryDeleteObject(ctx context.Context, signer COSObjectDeleter, objectKey string) error {
	if signer == nil {
		return nil
	}
	objectKey = StripPublicObjectURL(objectKey)
	if objectKey == "" {
		return nil
	}
	if err := signer.DeleteObject(ctx, objectKey); err != nil {
		return fmt.Errorf("删除 COS 对象 %q 失败: %w", objectKey, err)
	}
	return nil
}

func deletePublishedCatalogObjects(
	ctx context.Context,
	entry map[string]any,
	resourceMap map[string]string,
	imageMap map[string]string,
	idKey string,
	signers UploadDeleteSigners,
) error {
	materialType := strings.ToLower(stringifyCatalogValue(entry["materialType"]))
	downloadKey := strings.TrimSpace(resourceMap[idKey])
	if downloadKey == "" {
		downloadKey = StripPublicObjectURL(stringifyCatalogValue(entry["download"]))
	}
	imageKey := strings.TrimSpace(imageMap[idKey])
	if imageKey == "" {
		imageKey = StripPublicObjectURL(stringifyCatalogValue(entry["image"]))
	}
	var deleteErrs []error
	deleteOnce := func(signer COSObjectDeleter, key string) {
		key = StripPublicObjectURL(key)
		if key == "" {
			return
		}
		if err := tryDeleteObject(ctx, signer, key); err != nil {
			deleteErrs = append(deleteErrs, err)
		}
	}
	switch materialType {
	case "gif":
		deleteOnce(signers.Gif, downloadKey)
		deleteOnce(signers.GifCover, imageKey)
	case "video":
		deleteOnce(signers.Video, downloadKey)
		deleteOnce(signers.VideoCover, imageKey)
	default:
		deleteOnce(signers.Image, downloadKey)
		if imageKey != "" && imageKey != downloadKey {
			deleteOnce(signers.Image, imageKey)
		}
	}
	return errors.Join(deleteErrs...)
}

func DeleteOwnPublishedUpload(ctx context.Context, input DeleteOwnPublishedUploadInput) error {
	serial := normalizeUploaderSerial(input.Serial)
	if !input.AllowAnyOwner && serial == "" {
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
	if !input.AllowAnyOwner && !catalogEntryOwnedBySerial(entry, serial) {
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
	if err := deletePublishedCatalogObjects(ctx, entry, resourceMap, imageMap, idKey, input.Signers); err != nil {
		return err
	}
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

func reviewVideoObjectKey(item PendingImageReview) string {
	if key := strings.TrimSpace(item.GifObjectKey); key != "" {
		return key
	}
	return strings.TrimSpace(item.ImageObjectKey)
}

func reviewCoverObjectKey(item PendingImageReview) string {
	if key := strings.TrimSpace(item.CoverObjectKey); key != "" {
		return key
	}
	return strings.TrimSpace(item.ImageObjectKey)
}

func reviewShareObjectKey(item PendingImageReview) string {
	switch strings.TrimSpace(item.Action) {
	case ReviewActionShareUserGif:
		return strings.TrimSpace(item.GifObjectKey)
	case ReviewActionShareUserVideo:
		return reviewVideoObjectKey(item)
	default:
		return strings.TrimSpace(item.ImageObjectKey)
	}
}

func objectKeysMatch(left, right string) bool {
	left = StripPublicObjectURL(strings.TrimSpace(left))
	right = StripPublicObjectURL(strings.TrimSpace(right))
	if left == "" || right == "" {
		return false
	}
	if left == right {
		return true
	}
	if mp4ObjectKey(left) == mp4ObjectKey(right) {
		return true
	}
	return strings.EqualFold(left, right)
}

func catalogDownloadKey(entry map[string]any, resourceMap map[string]string, idKey string) string {
	if downloadKey := strings.TrimSpace(resourceMap[idKey]); downloadKey != "" {
		return StripPublicObjectURL(downloadKey)
	}
	return StripPublicObjectURL(stringifyCatalogValue(entry["download"]))
}

func catalogImageKey(entry map[string]any, imageMap map[string]string, idKey string) string {
	if imageKey := strings.TrimSpace(imageMap[idKey]); imageKey != "" {
		return StripPublicObjectURL(imageKey)
	}
	return StripPublicObjectURL(stringifyCatalogValue(entry["image"]))
}

func findPublishedResourceIDForReview(
	resources []map[string]any,
	resourceMap map[string]string,
	imageMap map[string]string,
	item PendingImageReview,
	serial string,
) int64 {
	shareKey := reviewShareObjectKey(item)
	coverKey := reviewCoverObjectKey(item)
	if shareKey == "" {
		return 0
	}
	for _, entry := range resources {
		if entry == nil || !catalogEntryOwnedBySerial(entry, serial) {
			continue
		}
		idKey := stringifyCatalogID(entry["id"])
		if idKey == "" {
			continue
		}
		downloadKey := catalogDownloadKey(entry, resourceMap, idKey)
		if !objectKeysMatch(downloadKey, shareKey) {
			continue
		}
		if coverKey != "" {
			imageKey := catalogImageKey(entry, imageMap, idKey)
			if imageKey != "" && !objectKeysMatch(imageKey, coverKey) {
				continue
			}
		}
		resourceID, err := strconv.ParseInt(idKey, 10, 64)
		if err != nil || resourceID <= 0 {
			continue
		}
		return resourceID
	}
	return 0
}

func reviewItemMatchesPublishedResource(item PendingImageReview, downloadKey, coverKey string) bool {
	shareKey := reviewShareObjectKey(item)
	if shareKey == "" || !objectKeysMatch(downloadKey, shareKey) {
		return false
	}
	itemCoverKey := reviewCoverObjectKey(item)
	if itemCoverKey == "" || coverKey == "" {
		return true
	}
	return objectKeysMatch(coverKey, itemCoverKey)
}

func RemoveReviewEntriesForPublishedResource(
	store *ImageReviewStore,
	serial string,
	entry map[string]any,
	resourceMap map[string]string,
	imageMap map[string]string,
	idKey string,
) {
	if store == nil || entry == nil || len(store.Items) == 0 {
		return
	}
	downloadKey := catalogDownloadKey(entry, resourceMap, idKey)
	coverKey := catalogImageKey(entry, imageMap, idKey)
	target := normalizeUploaderSerial(serial)
	if target == "" || downloadKey == "" {
		return
	}

	filtered := make([]PendingImageReview, 0, len(store.Items))
	for _, item := range store.Items {
		if normalizeUploaderSerial(item.Serial) != target || !isShareReviewAction(item.Action) {
			filtered = append(filtered, item)
			continue
		}
		if reviewItemMatchesPublishedResource(item, downloadKey, coverKey) {
			continue
		}
		filtered = append(filtered, item)
	}
	store.Items = filtered
}

func deleteReviewObjects(ctx context.Context, item PendingImageReview, signers UploadDeleteSigners) error {
	var deleteErrs []error
	deleteOne := func(signer COSObjectDeleter, key string) {
		if err := tryDeleteObject(ctx, signer, key); err != nil {
			deleteErrs = append(deleteErrs, err)
		}
	}
	switch strings.TrimSpace(item.Action) {
	case ReviewActionShareUserGif:
		deleteOne(signers.Gif, item.GifObjectKey)
		deleteOne(signers.GifCover, reviewCoverObjectKey(item))
	case ReviewActionShareUserVideo:
		deleteOne(signers.Video, reviewVideoObjectKey(item))
		deleteOne(signers.VideoCover, reviewCoverObjectKey(item))
	default:
		deleteOne(signers.Image, item.ImageObjectKey)
	}
	return errors.Join(deleteErrs...)
}

// DeleteReviewObjects removes the staged COS objects referenced by a review
// item.  It is exported for administrator bulk-purge paths; callers should
// remove the review record only after this function succeeds so a transient
// COS failure remains retryable.
func DeleteReviewObjects(ctx context.Context, item PendingImageReview, signers UploadDeleteSigners) error {
	return deleteReviewObjects(ctx, item, signers)
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
	if status != ImageReviewStatusPending &&
		status != ImageReviewStatusRejected &&
		status != ImageReviewStatusApproved {
		return PendingImageReview{}, fmt.Errorf("当前状态不可删除")
	}
	store.Items = append(store.Items[:idx], store.Items[idx+1:]...)
	return item, nil
}

type DeleteOwnReviewUploadInput struct {
	Store           *ImageReviewStore
	ReviewID        string
	Serial          string
	Signers         UploadDeleteSigners
	ResourcesPath   string
	ResourceMapPath string
	ImageMapPath    string
}

type DeleteOwnReviewUploadResult struct {
	Item              PendingImageReview
	DeletedResourceID int64
}

func DeleteOwnReviewUpload(ctx context.Context, input DeleteOwnReviewUploadInput) (DeleteOwnReviewUploadResult, error) {
	if input.Store == nil {
		return DeleteOwnReviewUploadResult{}, fmt.Errorf("复核队列未配置")
	}
	item, _, ok := input.Store.Find(strings.TrimSpace(input.ReviewID))
	if !ok {
		return DeleteOwnReviewUploadResult{}, fmt.Errorf("上传记录不存在")
	}
	if normalizeUploaderSerial(item.Serial) != normalizeUploaderSerial(input.Serial) {
		return DeleteOwnReviewUploadResult{}, fmt.Errorf("无权删除该素材")
	}
	if !isShareReviewAction(item.Action) {
		return DeleteOwnReviewUploadResult{}, fmt.Errorf("该记录不可删除")
	}
	status := strings.TrimSpace(strings.ToLower(item.Status))
	if status != ImageReviewStatusPending &&
		status != ImageReviewStatusRejected &&
		status != ImageReviewStatusApproved {
		return DeleteOwnReviewUploadResult{}, fmt.Errorf("当前状态不可删除")
	}

	result := DeleteOwnReviewUploadResult{Item: item}
	if input.ResourcesPath != "" {
		resources, loadErr := loadResourceCatalogFile(input.ResourcesPath)
		if loadErr == nil {
			resourceMap, mapErr := loadStringMapFile(input.ResourceMapPath)
			if mapErr == nil {
				imageMap, imageErr := loadStringMapFile(input.ImageMapPath)
				if imageErr == nil {
					if resourceID := findPublishedResourceIDForReview(
						resources,
						resourceMap,
						imageMap,
						item,
						input.Serial,
					); resourceID > 0 {
						if deleteErr := DeleteOwnPublishedUpload(ctx, DeleteOwnPublishedUploadInput{
							Serial:          input.Serial,
							ResourceID:      resourceID,
							ResourcesPath:   input.ResourcesPath,
							ResourceMapPath: input.ResourceMapPath,
							ImageMapPath:    input.ImageMapPath,
							Signers:         input.Signers,
						}); deleteErr != nil {
							return DeleteOwnReviewUploadResult{}, deleteErr
						} else {
							result.DeletedResourceID = resourceID
						}
					}
				}
			}
		}
	}

	// Published deletion already removed the same media and cover objects.
	if result.DeletedResourceID == 0 {
		if err := deleteReviewObjects(ctx, item, input.Signers); err != nil {
			return DeleteOwnReviewUploadResult{}, err
		}
	}
	if _, err := RemoveDeviceReviewUpload(input.Store, input.ReviewID, input.Serial); err != nil {
		return DeleteOwnReviewUploadResult{}, err
	}
	return result, nil
}
