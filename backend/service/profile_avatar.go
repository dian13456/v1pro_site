package service

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

const MaxProfileAvatarBytes = 512 << 10

func DecodeProfileAvatar(imageBase64, requestedContentType string) ([]byte, string, string, error) {
	rawInput := strings.TrimSpace(imageBase64)
	if rawInput == "" {
		return nil, "", "", fmt.Errorf("头像图片不能为空")
	}
	dataContentType := ""
	if strings.HasPrefix(strings.ToLower(rawInput), "data:") {
		comma := strings.Index(rawInput, ",")
		if comma <= 5 {
			return nil, "", "", fmt.Errorf("头像数据格式无效")
		}
		header := rawInput[5:comma]
		parts := strings.Split(header, ";")
		dataContentType = normalizeProfileAvatarContentType(parts[0])
		if len(parts) < 2 || !strings.EqualFold(parts[len(parts)-1], "base64") {
			return nil, "", "", fmt.Errorf("头像数据必须使用 Base64 编码")
		}
		rawInput = rawInput[comma+1:]
	}
	if len(rawInput) > (MaxProfileAvatarBytes*4/3)+16 {
		return nil, "", "", fmt.Errorf("头像不能超过 512KB")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(rawInput))
	if err != nil {
		return nil, "", "", fmt.Errorf("头像解码失败")
	}
	if len(data) == 0 || len(data) > MaxProfileAvatarBytes {
		return nil, "", "", fmt.Errorf("头像不能超过 512KB")
	}
	detected, extension := detectProfileAvatarType(data)
	if detected == "" {
		return nil, "", "", fmt.Errorf("头像仅支持 JPG、PNG 或 WebP 图片")
	}
	requested := normalizeProfileAvatarContentType(requestedContentType)
	if requested != "" && requested != detected {
		return nil, "", "", fmt.Errorf("头像文件类型与内容不一致")
	}
	if dataContentType != "" && dataContentType != detected {
		return nil, "", "", fmt.Errorf("头像数据类型与内容不一致")
	}
	return data, detected, extension, nil
}

func normalizeProfileAvatarContentType(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(strings.Split(raw, ";")[0]))
	if raw == "image/jpg" {
		return "image/jpeg"
	}
	switch raw {
	case "image/jpeg", "image/png", "image/webp":
		return raw
	default:
		return ""
	}
}

func detectProfileAvatarType(data []byte) (string, string) {
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "image/jpeg", ".jpg"
	}
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png", ".png"
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp", ".webp"
	}
	return "", ""
}

func ProfileAvatarObjectKey(serial, extension string, now time.Time) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(serial)))
	if extension != ".jpg" && extension != ".png" && extension != ".webp" {
		extension = ".webp"
	}
	return fmt.Sprintf("profile-avatars/%x/%d%s", digest[:12], now.UnixNano(), extension)
}

func FindProfileSerialByDisplayName(store UserProfilesStore, displayName string) string {
	target := strings.TrimSpace(displayName)
	if target == "" {
		return ""
	}
	seen := make(map[string]struct{}, len(store.Profiles)+len(store.Avatars))
	for serial := range store.Profiles {
		seen[serial] = struct{}{}
	}
	for serial := range store.Avatars {
		seen[serial] = struct{}{}
	}
	for serial := range seen {
		if strings.EqualFold(ResolveStoredDisplayName(store, serial, ""), target) {
			return serial
		}
	}
	return ""
}
