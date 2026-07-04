package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	MaxUserVideoUploadBytes = 20 << 20 // 20 MiB
	VideoUploadSessionTTL   = 30 * time.Minute
	VideoUploadPutURLTTL    = 20 * time.Minute
)

var allowedUserVideoExtensions = map[string]string{
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".mov":  "video/quicktime",
	".m4v":  "video/x-m4v",
}

type VideoUploadSession struct {
	ID             string `json:"sessionId"`
	Serial         string `json:"-"`
	VideoObjectKey string `json:"videoObjectKey"`
	CoverObjectKey string `json:"coverObjectKey"`
	ExpectedSize   int64  `json:"expectedSize"`
	FileName       string `json:"fileName"`
	CreatedAt      time.Time
}

type VideoUploadSessionStore struct {
	mu       sync.Mutex
	sessions map[string]VideoUploadSession
}

func NewVideoUploadSessionStore() *VideoUploadSessionStore {
	return &VideoUploadSessionStore{sessions: map[string]VideoUploadSession{}}
}

func (store *VideoUploadSessionStore) purgeExpired(now time.Time) {
	for id, session := range store.sessions {
		if now.Sub(session.CreatedAt) > VideoUploadSessionTTL {
			delete(store.sessions, id)
		}
	}
}

type CreateVideoUploadSessionInput struct {
	Serial      string
	FileName    string
	FileSize    int64
	VideoSigner *COSSigner
	CoverSigner *COSSigner
}

type CreateVideoUploadSessionResult struct {
	SessionID       string `json:"sessionId"`
	VideoUploadURL  string `json:"videoUploadUrl"`
	CoverUploadURL  string `json:"coverUploadUrl"`
	VideoObjectKey  string `json:"videoObjectKey"`
	CoverObjectKey  string `json:"coverObjectKey"`
	MaxBytes        int64  `json:"maxBytes"`
}

func CreateVideoUploadSession(
	ctx context.Context,
	store *VideoUploadSessionStore,
	input CreateVideoUploadSessionInput,
) (*CreateVideoUploadSessionResult, error) {
	if store == nil {
		return nil, fmt.Errorf("上传会话存储未配置")
	}
	if input.VideoSigner == nil || input.CoverSigner == nil {
		return nil, fmt.Errorf("视频存储未配置")
	}

	serial := normalizeUploaderSerial(input.Serial)
	if serial == "" {
		return nil, fmt.Errorf("设备 SN 无效")
	}

	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		return nil, fmt.Errorf("文件名不能为空")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	contentType, ok := allowedUserVideoExtensions[ext]
	if !ok {
		return nil, fmt.Errorf("仅支持 .mp4、.webm、.mov、.m4v 文件")
	}
	if input.FileSize <= 0 {
		return nil, fmt.Errorf("文件大小无效")
	}
	if input.FileSize > MaxUserVideoUploadBytes {
		return nil, fmt.Errorf("视频文件不能超过 %s", formatByteSize(int(MaxUserVideoUploadBytes)))
	}

	code, err := randomHexCode(8)
	if err != nil {
		return nil, fmt.Errorf("生成上传编号失败")
	}
	now := time.Now()
	videoObjectKey := makeMediaObjectKey(code, ext, "vid", now)
	coverObjectKey := makeMediaObjectKey(code, ".jpg", "cover", now)

	videoUploadURL, err := input.VideoSigner.GeneratePutURL(ctx, videoObjectKey, contentType, VideoUploadPutURLTTL)
	if err != nil {
		return nil, fmt.Errorf("生成视频上传地址失败")
	}
	coverUploadURL, err := input.CoverSigner.GeneratePutURL(ctx, coverObjectKey, "image/jpeg", VideoUploadPutURLTTL)
	if err != nil {
		return nil, fmt.Errorf("生成封面上传地址失败")
	}

	sessionID, err := randomHexCode(16)
	if err != nil {
		return nil, fmt.Errorf("生成会话编号失败")
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.purgeExpired(now)
	store.sessions[sessionID] = VideoUploadSession{
		ID:             sessionID,
		Serial:         serial,
		VideoObjectKey: videoObjectKey,
		CoverObjectKey: coverObjectKey,
		ExpectedSize:   input.FileSize,
		FileName:       fileName,
		CreatedAt:      now,
	}

	return &CreateVideoUploadSessionResult{
		SessionID:      sessionID,
		VideoUploadURL: videoUploadURL,
		CoverUploadURL: coverUploadURL,
		VideoObjectKey: videoObjectKey,
		CoverObjectKey: coverObjectKey,
		MaxBytes:       MaxUserVideoUploadBytes,
	}, nil
}

func (store *VideoUploadSessionStore) Get(sessionID, serial string) (VideoUploadSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	serial = normalizeUploaderSerial(serial)
	if sessionID == "" || serial == "" {
		return VideoUploadSession{}, fmt.Errorf("上传会话无效")
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.purgeExpired(time.Now())

	session, ok := store.sessions[sessionID]
	if !ok {
		return VideoUploadSession{}, fmt.Errorf("上传会话不存在或已过期")
	}
	if session.Serial != serial {
		return VideoUploadSession{}, fmt.Errorf("上传会话与当前设备不匹配")
	}
	return session, nil
}

func (store *VideoUploadSessionStore) Consume(sessionID, serial string) (VideoUploadSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	serial = normalizeUploaderSerial(serial)
	if sessionID == "" || serial == "" {
		return VideoUploadSession{}, fmt.Errorf("上传会话无效")
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.purgeExpired(time.Now())

	session, ok := store.sessions[sessionID]
	if !ok {
		return VideoUploadSession{}, fmt.Errorf("上传会话不存在或已过期")
	}
	if session.Serial != serial {
		return VideoUploadSession{}, fmt.Errorf("上传会话与当前设备不匹配")
	}
	delete(store.sessions, sessionID)
	return session, nil
}

type ShareUserVideoInput struct {
	Title          string
	Description    string
	ColumnTag      string
	Author         string
	UploaderSerial string
	VideoObjectKey string
	CoverObjectKey string
	VideoSizeBytes int64
}

func VerifyUploadedVideoObjects(
	ctx context.Context,
	videoSigner *COSSigner,
	coverSigner *COSSigner,
	session VideoUploadSession,
) (int64, error) {
	if videoSigner == nil || coverSigner == nil {
		return 0, fmt.Errorf("视频存储未配置")
	}

	videoHead, err := videoSigner.HeadObject(ctx, session.VideoObjectKey)
	if err != nil {
		return 0, fmt.Errorf("未检测到视频文件，请先完成上传")
	}
	if videoHead.ContentLength <= 0 {
		return 0, fmt.Errorf("视频文件为空")
	}
	if videoHead.ContentLength > MaxUserVideoUploadBytes {
		return 0, fmt.Errorf("视频文件超过大小限制")
	}
	if session.ExpectedSize > 0 && videoHead.ContentLength > session.ExpectedSize*11/10 {
		return 0, fmt.Errorf("视频文件大小与声明不一致")
	}

	coverHead, err := coverSigner.HeadObject(ctx, session.CoverObjectKey)
	if err != nil {
		return 0, fmt.Errorf("未检测到视频封面，请先完成上传")
	}
	if coverHead.ContentLength <= 0 {
		return 0, fmt.Errorf("视频封面为空")
	}
	if coverHead.ContentLength > maxIMSFileBytes {
		return 0, fmt.Errorf("视频封面过大")
	}

	return videoHead.ContentLength, nil
}

func ShareUserVideoToCatalog(
	resourcesPath string,
	resourceMapPath string,
	imageMapPath string,
	input ShareUserVideoInput,
) (*ShareAIImageResult, error) {
	videoObjectKey := strings.TrimSpace(input.VideoObjectKey)
	coverObjectKey := strings.TrimSpace(input.CoverObjectKey)
	if videoObjectKey == "" || coverObjectKey == "" {
		return nil, fmt.Errorf("视频或封面路径无效")
	}

	code, err := randomHexCode(8)
	if err != nil {
		return nil, fmt.Errorf("生成资源编号失败")
	}
	now := time.Now()
	resourceID := makeAIResourceID(code, now)
	title := normalizeUserVideoTitle(input.Title, input.Description, input.VideoObjectKey)
	description := normalizeUserVideoDescription(input.Description, title)
	sizeLabel := formatByteSize(int(input.VideoSizeBytes))
	if input.VideoSizeBytes <= 0 {
		sizeLabel = "未知"
	}
	updatedAt := now.Format(time.RFC3339)

	aiImageShareMu.Lock()
	defer aiImageShareMu.Unlock()

	resources, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		return nil, fmt.Errorf("读取素材清单失败")
	}
	resourceMap, err := loadStringMapFile(resourceMapPath)
	if err != nil {
		return nil, fmt.Errorf("读取素材映射失败")
	}
	imageMap, err := loadStringMapFile(imageMapPath)
	if err != nil {
		return nil, fmt.Errorf("读取封面映射失败")
	}

	for existsResourceID(resources, resourceID) {
		code, err = randomHexCode(8)
		if err != nil {
			return nil, fmt.Errorf("生成资源编号失败")
		}
		resourceID = makeAIResourceID(code, now)
	}

	entry := map[string]any{
		"id":           resourceID,
		"title":        title,
		"description":  description,
		"size":         sizeLabel,
		"image":        coverObjectKey,
		"download":     videoObjectKey,
		"category":     "gif",
		"materialType": "video",
		"updatedAt":    updatedAt,
	}
	if author := strings.TrimSpace(input.Author); author != "" {
		entry["author"] = author
	}
	if columnTag := strings.TrimSpace(input.ColumnTag); columnTag != "" {
		entry["columnTag"] = columnTag
	}
	uploaderSerial := normalizeUploaderSerial(input.UploaderSerial)
	if uploaderSerial != "" {
		entry[catalogUploaderSerialKey] = uploaderSerial
	}

	resources = append(resources, entry)
	sortResourcesByID(resources)
	idKey := strconv.FormatInt(resourceID, 10)
	resourceMap[idKey] = videoObjectKey
	imageMap[idKey] = coverObjectKey

	if err := saveResourceCatalogFile(resourcesPath, resources); err != nil {
		return nil, fmt.Errorf("保存素材清单失败")
	}
	if err := saveStringMapFile(resourceMapPath, resourceMap); err != nil {
		return nil, fmt.Errorf("保存素材映射失败")
	}
	if err := saveStringMapFile(imageMapPath, imageMap); err != nil {
		return nil, fmt.Errorf("保存封面映射失败")
	}

	return &ShareAIImageResult{
		ResourceID:  resourceID,
		ObjectKey:   videoObjectKey,
		DownloadURL: videoObjectKey,
		Title:       title,
	}, nil
}

func normalizeUserVideoTitle(title, description, fallbackKey string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return truncateRunes(title, maxAIShareTitleRunes)
	}
	description = strings.TrimSpace(description)
	if description != "" {
		return truncateRunes(description, maxAIShareTitleRunes)
	}
	base := strings.TrimSuffix(filepath.Base(fallbackKey), filepath.Ext(fallbackKey))
	if base != "" {
		return truncateRunes(base, maxAIShareTitleRunes)
	}
	return "用户上传视频"
}

func normalizeUserVideoDescription(description, title string) string {
	description = strings.TrimSpace(description)
	if description != "" {
		return truncateRunes(description, maxAISharePromptRunes)
	}
	title = strings.TrimSpace(title)
	if title != "" {
		return truncateRunes(title, maxAISharePromptRunes)
	}
	return "用户上传视频"
}

const maxUserVideoCoverUploadBytes = 8 << 20

func UploadVideoSessionFile(
	ctx context.Context,
	store *VideoUploadSessionStore,
	videoSigner *COSSigner,
	coverSigner *COSSigner,
	serial string,
	sessionID string,
	kind string,
	data []byte,
) error {
	if store == nil {
		return fmt.Errorf("上传会话存储未配置")
	}
	if videoSigner == nil || coverSigner == nil {
		return fmt.Errorf("视频存储未配置")
	}
	if len(data) == 0 {
		return fmt.Errorf("上传文件为空")
	}

	session, err := store.Get(sessionID, serial)
	if err != nil {
		return err
	}

	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "video":
		if int64(len(data)) > MaxUserVideoUploadBytes {
			return fmt.Errorf("视频文件不能超过 %s", formatByteSize(int(MaxUserVideoUploadBytes)))
		}
		if session.ExpectedSize > 0 && int64(len(data)) > session.ExpectedSize*11/10 {
			return fmt.Errorf("视频文件大小与声明不一致")
		}
		ext := strings.ToLower(filepath.Ext(session.FileName))
		contentType, ok := allowedUserVideoExtensions[ext]
		if !ok {
			return fmt.Errorf("不支持的视频格式")
		}
		return videoSigner.UploadObject(ctx, session.VideoObjectKey, contentType, data)
	case "cover":
		if int64(len(data)) > maxUserVideoCoverUploadBytes {
			return fmt.Errorf("封面文件过大")
		}
		return coverSigner.UploadObject(ctx, session.CoverObjectKey, "image/jpeg", data)
	default:
		return fmt.Errorf("不支持的上传类型")
	}
}
