package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	MaxUserGifUploadBytes = 15 << 20 // 15 MiB
	GifUploadSessionTTL   = 30 * time.Minute
	GifUploadPutURLTTL    = 20 * time.Minute
)

type GifUploadSession struct {
	ID             string `json:"sessionId"`
	Serial         string `json:"-"`
	GifObjectKey   string `json:"gifObjectKey"`
	CoverObjectKey string `json:"coverObjectKey"`
	ExpectedSize   int64  `json:"expectedSize"`
	FileName       string `json:"fileName"`
	CreatedAt      time.Time
}

type GifUploadSessionStore struct {
	mu       sync.Mutex
	sessions map[string]GifUploadSession
}

func NewGifUploadSessionStore() *GifUploadSessionStore {
	return &GifUploadSessionStore{sessions: map[string]GifUploadSession{}}
}

func (store *GifUploadSessionStore) purgeExpired(now time.Time) {
	for id, session := range store.sessions {
		if now.Sub(session.CreatedAt) > GifUploadSessionTTL {
			delete(store.sessions, id)
		}
	}
}

type CreateGifUploadSessionInput struct {
	Serial      string
	FileName    string
	FileSize    int64
	GifSigner   *COSSigner
	CoverSigner *COSSigner
}

type CreateGifUploadSessionResult struct {
	SessionID      string `json:"sessionId"`
	GifUploadURL   string `json:"gifUploadUrl"`
	CoverUploadURL string `json:"coverUploadUrl"`
	GifObjectKey   string `json:"gifObjectKey"`
	CoverObjectKey string `json:"coverObjectKey"`
	MaxBytes       int64  `json:"maxBytes"`
}

func CreateGifUploadSession(
	ctx context.Context,
	store *GifUploadSessionStore,
	input CreateGifUploadSessionInput,
) (*CreateGifUploadSessionResult, error) {
	if store == nil {
		return nil, fmt.Errorf("上传会话存储未配置")
	}
	if input.GifSigner == nil || input.CoverSigner == nil {
		return nil, fmt.Errorf("GIF 存储未配置")
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
	if ext != ".gif" {
		return nil, fmt.Errorf("仅支持 .gif 文件")
	}
	if input.FileSize <= 0 {
		return nil, fmt.Errorf("文件大小无效")
	}
	if input.FileSize > MaxUserGifUploadBytes {
		return nil, fmt.Errorf("GIF 文件不能超过 %s", formatByteSize(int(MaxUserGifUploadBytes)))
	}

	code, err := randomHexCode(8)
	if err != nil {
		return nil, fmt.Errorf("生成上传编号失败")
	}
	now := time.Now()
	gifObjectKey := makeMediaObjectKey(code, ".gif", "gif", now)
	coverObjectKey := makeMediaObjectKey(code, ".jpg", "gif_cover", now)

	gifUploadURL, err := input.GifSigner.GeneratePutURL(ctx, gifObjectKey, "image/gif", GifUploadPutURLTTL)
	if err != nil {
		return nil, fmt.Errorf("生成 GIF 上传地址失败")
	}
	coverUploadURL, err := input.CoverSigner.GeneratePutURL(ctx, coverObjectKey, "image/jpeg", GifUploadPutURLTTL)
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
	store.sessions[sessionID] = GifUploadSession{
		ID:             sessionID,
		Serial:         serial,
		GifObjectKey:   gifObjectKey,
		CoverObjectKey: coverObjectKey,
		ExpectedSize:   input.FileSize,
		FileName:       fileName,
		CreatedAt:      now,
	}

	return &CreateGifUploadSessionResult{
		SessionID:      sessionID,
		GifUploadURL:   gifUploadURL,
		CoverUploadURL: coverUploadURL,
		GifObjectKey:   gifObjectKey,
		CoverObjectKey: coverObjectKey,
		MaxBytes:       MaxUserGifUploadBytes,
	}, nil
}

func (store *GifUploadSessionStore) Get(sessionID, serial string) (GifUploadSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	serial = normalizeUploaderSerial(serial)
	if sessionID == "" || serial == "" {
		return GifUploadSession{}, fmt.Errorf("上传会话无效")
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.purgeExpired(time.Now())

	session, ok := store.sessions[sessionID]
	if !ok {
		return GifUploadSession{}, fmt.Errorf("上传会话不存在或已过期")
	}
	if session.Serial != serial {
		return GifUploadSession{}, fmt.Errorf("上传会话与当前设备不匹配")
	}
	return session, nil
}

func (store *GifUploadSessionStore) Consume(sessionID, serial string) (GifUploadSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	serial = normalizeUploaderSerial(serial)
	if sessionID == "" || serial == "" {
		return GifUploadSession{}, fmt.Errorf("上传会话无效")
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.purgeExpired(time.Now())

	session, ok := store.sessions[sessionID]
	if !ok {
		return GifUploadSession{}, fmt.Errorf("上传会话不存在或已过期")
	}
	if session.Serial != serial {
		return GifUploadSession{}, fmt.Errorf("上传会话与当前设备不匹配")
	}
	delete(store.sessions, sessionID)
	return session, nil
}

type ShareUserGifInput struct {
	Title          string
	Description    string
	Author         string
	UploaderSerial string
	GifObjectKey   string
	CoverObjectKey string
	GifSizeBytes   int64
}

func VerifyUploadedGifObjects(
	ctx context.Context,
	gifSigner *COSSigner,
	coverSigner *COSSigner,
	session GifUploadSession,
) (int64, error) {
	if gifSigner == nil || coverSigner == nil {
		return 0, fmt.Errorf("GIF 存储未配置")
	}

	gifHead, err := gifSigner.HeadObject(ctx, session.GifObjectKey)
	if err != nil {
		return 0, fmt.Errorf("未检测到 GIF 文件，请先完成上传")
	}
	if gifHead.ContentLength <= 0 {
		return 0, fmt.Errorf("GIF 文件为空")
	}
	if gifHead.ContentLength > MaxUserGifUploadBytes {
		return 0, fmt.Errorf("GIF 文件超过大小限制")
	}
	if session.ExpectedSize > 0 && gifHead.ContentLength > session.ExpectedSize*11/10 {
		return 0, fmt.Errorf("GIF 文件大小与声明不一致")
	}

	coverHead, err := coverSigner.HeadObject(ctx, session.CoverObjectKey)
	if err != nil {
		return 0, fmt.Errorf("未检测到 GIF 封面，请先完成上传")
	}
	if coverHead.ContentLength <= 0 {
		return 0, fmt.Errorf("GIF 封面为空")
	}
	if coverHead.ContentLength > maxIMSFileBytes {
		return 0, fmt.Errorf("GIF 封面过大")
	}

	return gifHead.ContentLength, nil
}

func ShareUserGifToCatalog(
	resourcesPath string,
	resourceMapPath string,
	imageMapPath string,
	input ShareUserGifInput,
) (*ShareAIImageResult, error) {
	gifObjectKey := strings.TrimSpace(input.GifObjectKey)
	coverObjectKey := strings.TrimSpace(input.CoverObjectKey)
	if gifObjectKey == "" || coverObjectKey == "" {
		return nil, fmt.Errorf("GIF 或封面路径无效")
	}

	code, err := randomHexCode(8)
	if err != nil {
		return nil, fmt.Errorf("生成资源编号失败")
	}
	now := time.Now()
	resourceID := makeAIResourceID(code, now)
	title := normalizeUserGifTitle(input.Title, input.Description, input.GifObjectKey)
	description := normalizeUserGifDescription(input.Description, title)
	sizeLabel := formatByteSize(int(input.GifSizeBytes))
	if input.GifSizeBytes <= 0 {
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
		"download":     gifObjectKey,
		"category":     "gif",
		"materialType": "gif",
		"updatedAt":    updatedAt,
	}
	if author := strings.TrimSpace(input.Author); author != "" {
		entry["author"] = author
	}
	uploaderSerial := normalizeUploaderSerial(input.UploaderSerial)
	if uploaderSerial != "" {
		entry[catalogUploaderSerialKey] = uploaderSerial
	}

	resources = append(resources, entry)
	sortResourcesByID(resources)
	idKey := strconv.FormatInt(resourceID, 10)
	resourceMap[idKey] = gifObjectKey
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
		ObjectKey:   gifObjectKey,
		DownloadURL: gifObjectKey,
		Title:       title,
	}, nil
}

func makeMediaObjectKey(code, ext, prefix string, now time.Time) string {
	normalizedExt := strings.ToLower(ext)
	if normalizedExt == "" {
		normalizedExt = ".gif"
	}
	if !strings.HasPrefix(normalizedExt, ".") {
		normalizedExt = "." + normalizedExt
	}
	return fmt.Sprintf("%s_%s_%s%s", prefix, now.Format("20060102150405"), code, normalizedExt)
}

func normalizeUserGifTitle(title, description, fallbackKey string) string {
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
	return "用户上传 GIF"
}

func normalizeUserGifDescription(description, title string) string {
	description = strings.TrimSpace(description)
	if description != "" {
		return truncateRunes(description, maxAISharePromptRunes)
	}
	title = strings.TrimSpace(title)
	if title != "" {
		return truncateRunes(title, maxAISharePromptRunes)
	}
	return "用户上传 GIF"
}

func FetchObjectBytes(ctx context.Context, signer *COSSigner, objectKey string, maxBytes int64) ([]byte, error) {
	if signer == nil {
		return nil, fmt.Errorf("存储未配置")
	}
	if maxBytes <= 0 {
		maxBytes = maxIMSFileBytes
	}
	signedURL, err := signer.GenerateReadURL(ctx, objectKey, 10*time.Minute)
	if err != nil {
		return nil, err
	}
	return fetchURLBytesLimited(ctx, signedURL, maxBytes)
}

func fetchURLBytesLimited(ctx context.Context, url string, maxBytes int64) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("下载对象失败: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("对象过大")
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("对象为空")
	}
	return body, nil
}

const maxUserGifCoverUploadBytes = 8 << 20

func UploadGifSessionFile(
	ctx context.Context,
	store *GifUploadSessionStore,
	gifSigner *COSSigner,
	coverSigner *COSSigner,
	serial string,
	sessionID string,
	kind string,
	data []byte,
) error {
	if store == nil {
		return fmt.Errorf("上传会话存储未配置")
	}
	if gifSigner == nil || coverSigner == nil {
		return fmt.Errorf("GIF 存储未配置")
	}
	if len(data) == 0 {
		return fmt.Errorf("上传文件为空")
	}

	session, err := store.Get(sessionID, serial)
	if err != nil {
		return err
	}

	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "gif":
		if int64(len(data)) > MaxUserGifUploadBytes {
			return fmt.Errorf("GIF 文件不能超过 %s", formatByteSize(int(MaxUserGifUploadBytes)))
		}
		if session.ExpectedSize > 0 && int64(len(data)) > session.ExpectedSize*11/10 {
			return fmt.Errorf("GIF 文件大小与声明不一致")
		}
		return gifSigner.UploadObject(ctx, session.GifObjectKey, "image/gif", data)
	case "cover":
		if int64(len(data)) > maxUserGifCoverUploadBytes {
			return fmt.Errorf("封面文件过大")
		}
		return coverSigner.UploadObject(ctx, session.CoverObjectKey, "image/jpeg", data)
	default:
		return fmt.Errorf("不支持的上传类型")
	}
}
