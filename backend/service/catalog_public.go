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
		uploaderSerial := normalizeUploaderSerial(stringifyCatalogValue(item[catalogUploaderSerialKey]))
		if uploaderSerial == "" {
			uploaderSerial = normalizeUploaderSerial(stringifyCatalogValue(item["_uploaderSerial"]))
		}
		copy["uploaderBlockable"] = uploaderSerial != ""
		delete(copy, "download")
		delete(copy, catalogUploaderSerialKey)
		delete(copy, "_uploaderSerial")
		if imageRaw, ok := copy["image"].(string); ok {
			copy["image"] = StripPublicObjectURL(imageRaw)
		}
		sanitized = append(sanitized, copy)
	}
	return sanitized
}

// SelectPublicResourceCatalog returns sanitized catalog records in the exact
// order requested. It is used by the recommendation fast path so the browser
// can paint the first page without downloading the complete catalog first.
func SelectPublicResourceCatalog(items []map[string]any, resourceIDs []string) []map[string]any {
	if len(items) == 0 || len(resourceIDs) == 0 {
		return []map[string]any{}
	}
	byID := make(map[string]map[string]any, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		id := recommendationString(item["id"])
		if id != "" {
			byID[id] = item
		}
	}
	selected := make([]map[string]any, 0, len(resourceIDs))
	for _, id := range resourceIDs {
		if item := byID[id]; item != nil {
			selected = append(selected, item)
		}
	}
	return SanitizePublicResourceCatalog(selected)
}
