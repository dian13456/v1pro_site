package service

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const catalogUploaderSerialKey = "uploaderSerial"

// catalogUploaderSerialValue reads the private uploader key from both the
// current field and the legacy underscored field.  The latter was used by
// older catalog writers and must remain readable for ownership, moderation,
// and administrator purge operations.  Callers should never expose the
// returned value in a public catalog response.
func catalogUploaderSerialValue(item map[string]any) string {
	if item == nil {
		return ""
	}
	value := stringifyCatalogValue(item[catalogUploaderSerialKey])
	if value == "" {
		value = stringifyCatalogValue(item["_uploaderSerial"])
	}
	return normalizeUploaderSerial(value)
}

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
		return catalogUploaderSerialValue(item)
	}
	return ""
}

// ResourceIDsByUploaderSerials returns every catalog resource owned by a
// blocked uploader without exposing uploader serials in the public catalog.
func ResourceIDsByUploaderSerials(items []map[string]any, uploaderSerials []string) []string {
	blocked := make(map[string]struct{}, len(uploaderSerials))
	for _, serial := range uploaderSerials {
		if normalized := normalizeUploaderSerial(serial); normalized != "" {
			blocked[normalized] = struct{}{}
		}
	}
	if len(blocked) == 0 {
		return []string{}
	}
	ids := make([]string, 0)
	for _, item := range items {
		if item == nil {
			continue
		}
		uploader := catalogUploaderSerialValue(item)
		if _, ok := blocked[uploader]; !ok {
			continue
		}
		if id := stringifyCatalogID(item["id"]); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

// PrimaryCatalogAuthorsByUploaderSerial resolves the public author name that
// represents each uploader most consistently. Historical profile names can be
// changed or replaced while published catalog records retain their original
// author. Choosing the most frequent public author keeps leaderboard links
// pointed at the creator page that contains the uploader's actual works.
func PrimaryCatalogAuthorsByUploaderSerial(items []map[string]any) map[string]string {
	type authorStats struct {
		count     int
		lastIndex int
	}

	counts := make(map[string]map[string]authorStats)
	for index, item := range items {
		if item == nil {
			continue
		}
		serial := catalogUploaderSerialValue(item)
		author := strings.TrimSpace(stringifyCatalogValue(item["author"]))
		if serial == "" || author == "" {
			continue
		}
		if counts[serial] == nil {
			counts[serial] = make(map[string]authorStats)
		}
		stats := counts[serial][author]
		stats.count++
		stats.lastIndex = index
		counts[serial][author] = stats
	}

	primary := make(map[string]string, len(counts))
	for serial, authors := range counts {
		bestName := ""
		best := authorStats{lastIndex: -1}
		for author, stats := range authors {
			if stats.count > best.count || (stats.count == best.count && stats.lastIndex > best.lastIndex) {
				bestName = author
				best = stats
			}
		}
		if bestName != "" {
			primary[serial] = bestName
		}
	}
	return primary
}

// LoadUploaderSerialFromCatalogFile reads resources.json and finds uploader SN by resource id.
func LoadUploaderSerialFromCatalogFile(path, resourceID string) (string, error) {
	serial, _, err := LoadUploaderSerialWithPresenceFromCatalogFile(path, resourceID)
	return serial, err
}

// LoadUploaderSerialWithPresenceFromCatalogFile distinguishes a missing
// resource from a legacy resource that exists but has no private uploader key.
func LoadUploaderSerialWithPresenceFromCatalogFile(path, resourceID string) (string, bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", false, err
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return "", false, err
	}
	target := strings.TrimSpace(resourceID)
	for _, item := range items {
		if item == nil || stringifyCatalogID(item["id"]) != target {
			continue
		}
		return catalogUploaderSerialValue(item), true, nil
	}
	return "", false, nil
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

// CatalogResourceIDString returns the canonical decimal resource identifier
// from a decoded catalog value. Catalog JSON is decoded into interface values,
// so large numeric ids arrive as float64; callers must not use fmt.Sprint on
// those values because it may produce scientific notation that cannot be
// parsed back into the original id.
func CatalogResourceIDString(value any) string {
	return stringifyCatalogID(value)
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
