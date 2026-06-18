package service

import (
	"net/url"
	"strings"
)

func StripPublicObjectURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(raw), "http://") && !strings.HasPrefix(strings.ToLower(raw), "https://") {
		return strings.TrimPrefix(raw, "/")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	path := strings.TrimPrefix(parsed.Path, "/")
	if decoded, decodeErr := url.PathUnescape(path); decodeErr == nil {
		return decoded
	}
	return path
}

func SanitizePublicResourceCatalog(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return items
	}
	sanitized := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		copy := make(map[string]any, len(item))
		for key, value := range item {
			copy[key] = value
		}
		delete(copy, "download")
		delete(copy, catalogUploaderSerialKey)
		if imageRaw, ok := copy["image"].(string); ok {
			copy["image"] = StripPublicObjectURL(imageRaw)
		}
		sanitized = append(sanitized, copy)
	}
	return sanitized
}
