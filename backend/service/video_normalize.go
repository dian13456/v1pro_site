package service

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const videoProbeBytes = 512 * 1024

func videoNeedsWebNormalization(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	probe := data
	if len(probe) > videoProbeBytes {
		probe = probe[:videoProbeBytes]
	}
	text := string(probe)
	if strings.Contains(text, "hvc1") || strings.Contains(text, "hev1") || strings.Contains(text, "hvt1") {
		return true
	}
	if strings.Contains(text, "av01") || strings.Contains(text, "dav1") {
		return true
	}
	marker := []byte("avcC")
	index := bytes.Index(probe, marker)
	if index >= 0 && index+9 < len(probe) && probe[index+8] == 110 {
		return true
	}
	return false
}

func mp4ObjectKey(objectKey string) string {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return objectKey
	}
	ext := strings.ToLower(filepath.Ext(objectKey))
	if ext == ".mp4" {
		return objectKey
	}
	return strings.TrimSuffix(objectKey, filepath.Ext(objectKey)) + ".mp4"
}

func NormalizeVideoObjectForWebPlayback(
	ctx context.Context,
	signer *COSSigner,
	objectKey string,
) (string, int64, error) {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" || signer == nil {
		return objectKey, 0, fmt.Errorf("invalid normalize input")
	}

	data, err := signer.GetObject(ctx, objectKey)
	if err != nil {
		return objectKey, 0, err
	}
	if !videoNeedsWebNormalization(data) {
		return objectKey, int64(len(data)), nil
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return objectKey, 0, fmt.Errorf("视频编码不受 Edge 支持，且服务器未安装 ffmpeg 无法自动转码")
	}

	tempDir, err := os.MkdirTemp("", "video-normalize-*")
	if err != nil {
		return objectKey, 0, err
	}
	defer os.RemoveAll(tempDir)

	inputPath := filepath.Join(tempDir, "input"+filepath.Ext(objectKey))
	outputPath := filepath.Join(tempDir, "output.mp4")
	if err := os.WriteFile(inputPath, data, 0o600); err != nil {
		return objectKey, 0, err
	}

	cmd := exec.CommandContext(
		ctx,
		"ffmpeg",
		"-y",
		"-i", inputPath,
		"-c:v", "libx264",
		"-profile:v", "main",
		"-pix_fmt", "yuv420p",
		"-movflags", "+faststart",
		"-c:a", "aac",
		"-b:a", "128k",
		outputPath,
	)
	if output, runErr := cmd.CombinedOutput(); runErr != nil {
		log.Printf("warn: ffmpeg normalize failed: %v %s", runErr, string(output))
		return objectKey, 0, fmt.Errorf("视频转码失败，请上传 H.264 8-bit 的 MP4")
	}

	outputData, err := os.ReadFile(outputPath)
	if err != nil || len(outputData) == 0 {
		return objectKey, 0, fmt.Errorf("视频转码结果为空")
	}
	if int64(len(outputData)) > MaxUserVideoUploadBytes {
		return objectKey, 0, fmt.Errorf("转码后视频超过大小限制")
	}

	newKey := mp4ObjectKey(objectKey)
	if err := signer.UploadObject(ctx, newKey, "video/mp4", outputData); err != nil {
		return objectKey, 0, err
	}
	if newKey != objectKey {
		if deleteErr := signer.DeleteObject(ctx, objectKey); deleteErr != nil {
			log.Printf("warn: delete original video object failed: %v", deleteErr)
		}
	}
	return newKey, int64(len(outputData)), nil
}
