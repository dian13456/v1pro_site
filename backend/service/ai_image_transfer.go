package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"
)

const (
	maxAIImageTransferBytes = 8 << 20 // 8 MiB
	aiImageTransferPrefix   = "ai_transfer/"
)

var aiImageTransferFileNamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

func normalizeAIImageBase64(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("imageBase64 不能为空")
	}
	if strings.HasPrefix(raw, "data:") {
		comma := strings.Index(raw, ",")
		if comma <= 0 {
			return "", fmt.Errorf("无效的图片数据")
		}
		raw = raw[comma+1:]
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("无效的图片数据")
	}
	return raw, nil
}

func sanitizeAIImageFileName(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "ai-image.jpg"
	}
	raw = path.Base(raw)
	if !aiImageTransferFileNamePattern.MatchString(raw) {
		return "ai-image.jpg"
	}
	return raw
}

func aiImageTransferObjectKey(serial, fileName string, now time.Time) string {
	safeSerial := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(strings.TrimSpace(serial))
	if safeSerial == "" {
		safeSerial = "device"
	}
	ext := path.Ext(fileName)
	if ext == "" {
		ext = ".jpg"
	}
	return fmt.Sprintf(
		"%s%s/%s_%d%s",
		aiImageTransferPrefix,
		now.Format("20060102"),
		safeSerial,
		now.UnixNano(),
		ext,
	)
}

func StageAIImageForTransfer(
	ctx context.Context,
	signer *COSSigner,
	serial string,
	imageBase64 string,
	fileName string,
	signTTL time.Duration,
) (string, error) {
	if signer == nil {
		return "", fmt.Errorf("图片存储未配置")
	}

	encoded, err := normalizeAIImageBase64(imageBase64)
	if err != nil {
		return "", err
	}

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("图片解码失败")
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("图片内容为空")
	}
	if len(raw) > maxAIImageTransferBytes {
		return "", fmt.Errorf("图片过大，请重新生成较小的图片")
	}

	fileName = sanitizeAIImageFileName(fileName)
	objectKey := aiImageTransferObjectKey(serial, fileName, time.Now())
	contentType := "image/jpeg"
	if strings.EqualFold(path.Ext(fileName), ".png") {
		contentType = "image/png"
	}

	if err := signer.UploadObject(ctx, objectKey, contentType, raw); err != nil {
		return "", fmt.Errorf("上传临时图片失败")
	}

	signedURL, err := signer.GenerateReadURL(ctx, objectKey, signTTL)
	if err != nil {
		return "", fmt.Errorf("生成传输链接失败")
	}
	if !strings.HasPrefix(strings.ToLower(signedURL), "https://") {
		return "", fmt.Errorf("传输链接无效")
	}
	return signedURL, nil
}
