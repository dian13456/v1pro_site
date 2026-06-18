package service

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const catalogUploaderSerialKey = "uploaderSerial"

// FindUploaderSerial returns the uploader device SN for a catalog resource id.
func FindUploaderSerial(items []map[string]any, resourceID string) string {
	target := strings.TrimSpace(resourceID)
	if target == "" || len(items) == 0 {
		return ""
	}
	for _, item := range items {
		if item == nil {
			continue
		}
		idText := stringifyCatalogID(item["id"])
		if idText == "" || idText != target {
			continue
		}
		return normalizeUploaderSerial(stringifyCatalogValue(item[catalogUploaderSerialKey]))
	}
	return ""
}

// LoadUploaderSerialFromCatalogFile reads resources.json and finds uploader SN by resource id.
func LoadUploaderSerialFromCatalogFile(path, resourceID string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return "", err
	}
	return FindUploaderSerial(items, resourceID), nil
}

func stringifyCatalogID(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case json.Number:
		return strings.TrimSpace(typed.String())
	default:
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "<nil>" {
			return ""
		}
		return text
	}
}

func stringifyCatalogValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func normalizeUploaderSerial(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// ShouldAwardLikeCredit reports whether liker should grant credit to uploader.
func ShouldAwardLikeCredit(uploaderSerial, likerSerial string) bool {
	uploaderSerial = normalizeUploaderSerial(uploaderSerial)
	likerSerial = normalizeUploaderSerial(likerSerial)
	if uploaderSerial == "" || likerSerial == "" {
		return false
	}
	return uploaderSerial != likerSerial
}
