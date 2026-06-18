package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxAISharePromptRunes = 500
	maxAIShareTitleRunes  = 80
)

var aiImageShareMu sync.Mutex

type ShareAIImageInput struct {
	ImageBase64    string
	Prompt         string
	Title          string
	Author         string
	UploaderSerial string
}

type ShareAIImageResult struct {
	ResourceID  int64  `json:"resourceId"`
	ObjectKey   string `json:"objectKey"`
	DownloadURL string `json:"downloadUrl"`
	Title       string `json:"title"`
}

func ShareAIImageToCatalog(
	ctx context.Context,
	signer *COSSigner,
	imagePublicBase string,
	resourcesPath string,
	imageMapPath string,
	input ShareAIImageInput,
) (*ShareAIImageResult, error) {
	if signer == nil {
		return nil, fmt.Errorf("图片存储未配置")
	}

	raw, err := DecodeAIImageBytes(input.ImageBase64)
	if err != nil {
		return nil, err
	}

	code, err := randomHexCode(8)
	if err != nil {
		return nil, fmt.Errorf("生成资源编号失败")
	}

	now := time.Now()
	objectKey := makeAIImageObjectKey(code, ".jpg", "img", now)
	contentType := "image/jpeg"

	if err := signer.UploadObject(ctx, objectKey, contentType, raw); err != nil {
		return nil, fmt.Errorf("上传图片失败: %w", err)
	}

	resourceID := makeAIResourceID(code, now)
	title := normalizeAIShareTitle(input.Title, input.Prompt)
	description := normalizeAISharePrompt(input.Prompt)
	author := strings.TrimSpace(input.Author)
	downloadURL := buildImagePublicURL(imagePublicBase, objectKey)
	updatedAt := now.Format(time.RFC3339)

	aiImageShareMu.Lock()
	defer aiImageShareMu.Unlock()

	resources, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		return nil, fmt.Errorf("读取素材清单失败")
	}
	imageMap, err := loadStringMapFile(imageMapPath)
	if err != nil {
		return nil, fmt.Errorf("读取图片映射失败")
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
		"size":         formatByteSize(len(raw)),
		"image":        objectKey,
		"download":     objectKey,
		"category":     "gif",
		"materialType": "image",
		"updatedAt":    updatedAt,
	}
	if author != "" {
		entry["author"] = author
	}
	uploaderSerial := normalizeUploaderSerial(input.UploaderSerial)
	if uploaderSerial != "" {
		entry[catalogUploaderSerialKey] = uploaderSerial
	}

	resources = append(resources, entry)
	sortResourcesByID(resources)
	imageMap[strconv.FormatInt(resourceID, 10)] = objectKey

	if err := saveResourceCatalogFile(resourcesPath, resources); err != nil {
		return nil, fmt.Errorf("保存素材清单失败")
	}
	if err := saveStringMapFile(imageMapPath, imageMap); err != nil {
		return nil, fmt.Errorf("保存图片映射失败")
	}

	return &ShareAIImageResult{
		ResourceID:  resourceID,
		ObjectKey:   objectKey,
		DownloadURL: downloadURL,
		Title:       title,
	}, nil
}

func randomHexCode(length int) (string, error) {
	if length <= 0 {
		length = 8
	}
	buf := make([]byte, (length+1)/2)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf)[:length], nil
}

func makeAIResourceID(code string, now time.Time) int64 {
	timestampPart := now.Format("060102150405")
	randomPart := "0000"
	if code != "" {
		if parsed, err := strconv.ParseInt(code[:minInt(4, len(code))], 16, 64); err == nil {
			randomPart = fmt.Sprintf("%04d", parsed%10000)
		}
	}
	value, _ := strconv.ParseInt(timestampPart+randomPart, 10, 64)
	return value
}

func makeAIImageObjectKey(code, ext, prefix string, now time.Time) string {
	normalizedExt := strings.ToLower(ext)
	if normalizedExt == "" {
		normalizedExt = ".jpg"
	}
	if !strings.HasPrefix(normalizedExt, ".") {
		normalizedExt = "." + normalizedExt
	}
	return fmt.Sprintf("%s_%s_%s%s", prefix, now.Format("20060102150405"), code, normalizedExt)
}

func buildImagePublicURL(publicBase, objectKey string) string {
	publicBase = strings.TrimRight(strings.TrimSpace(publicBase), "/")
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if publicBase == "" {
		return objectKey
	}
	return publicBase + "/" + objectKey
}

func normalizeAIShareTitle(title, prompt string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return truncateRunes(title, maxAIShareTitleRunes)
	}
	prompt = strings.TrimSpace(prompt)
	if prompt != "" {
		return truncateRunes(prompt, maxAIShareTitleRunes)
	}
	return "AI 生成图片"
}

func normalizeAISharePrompt(prompt string) string {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "AI 生成图片"
	}
	return truncateRunes(prompt, maxAISharePromptRunes)
}

func formatByteSize(size int) string {
	if size < 1024 {
		return fmt.Sprintf("%dB", size)
	}
	if size < 1024*1024 {
		return fmt.Sprintf("%dKB", size/1024)
	}
	return fmt.Sprintf("%.1fMB", float64(size)/(1024*1024))
}

func existsResourceID(resources []map[string]any, id int64) bool {
	for _, item := range resources {
		switch value := item["id"].(type) {
		case float64:
			if int64(value) == id {
				return true
			}
		case int64:
			if value == id {
				return true
			}
		case int:
			if int64(value) == id {
				return true
			}
		case json.Number:
			if parsed, err := value.Int64(); err == nil && parsed == id {
				return true
			}
		}
	}
	return false
}

func sortResourcesByID(resources []map[string]any) {
	sort.Slice(resources, func(i, j int) bool {
		return resourceIDValue(resources[i]) < resourceIDValue(resources[j])
	})
}

func resourceIDValue(item map[string]any) int64 {
	switch value := item["id"].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	case json.Number:
		parsed, _ := value.Int64()
		return parsed
	default:
		return 0
	}
}

func loadResourceCatalogFile(path string) ([]map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	if list == nil {
		list = []map[string]any{}
	}
	return list, nil
}

func saveResourceCatalogFile(path string, resources []map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(resources, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func loadStringMapFile(path string) (map[string]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return map[string]string{}, nil
	}
	var data map[string]string
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if data == nil {
		data = map[string]string{}
	}
	return data, nil
}

func saveStringMapFile(path string, data map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
