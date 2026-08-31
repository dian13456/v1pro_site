package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

type publicResourceCatalogSnapshot struct {
	modTime     time.Time
	size        int64
	rawItems    []map[string]any
	publicItems []map[string]any
	publicJSON  []byte
	gzipJSON    []byte
	etag        string
}

type resourceCatalogSnapshotCache struct {
	mu       sync.Mutex
	entries  map[string]*publicResourceCatalogSnapshot
	failures map[string]resourceCatalogLoadFailure
}

var resourceCatalogCache = resourceCatalogSnapshotCache{
	entries:  make(map[string]*publicResourceCatalogSnapshot),
	failures: make(map[string]resourceCatalogLoadFailure),
}

const resourceCatalogRefreshRetryDelay = 2 * time.Second

type resourceCatalogLoadFailure struct {
	modTime    time.Time
	size       int64
	retryAfter time.Time
}

func normalizedCatalogPath(path string) string {
	cleaned := filepath.Clean(path)
	if absolute, err := filepath.Abs(cleaned); err == nil {
		return absolute
	}
	return cleaned
}

func sameCatalogFileVersion(snapshot *publicResourceCatalogSnapshot, info os.FileInfo) bool {
	return snapshot != nil && snapshot.size == info.Size() && snapshot.modTime.Equal(info.ModTime())
}

func buildPublicResourceCatalogSnapshot(path string, expected os.FileInfo) (*publicResourceCatalogSnapshot, error) {
	for attempt := 0; attempt < 2; attempt++ {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		actual, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if actual.Size() != expected.Size() || !actual.ModTime().Equal(expected.ModTime()) {
			expected = actual
			continue
		}

		var items []map[string]any
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
		if items == nil {
			items = []map[string]any{}
		}
		publicItems := service.SanitizePublicResourceCatalog(items)
		publicJSON, err := json.Marshal(publicItems)
		if err != nil {
			return nil, err
		}

		var compressed bytes.Buffer
		gzipWriter, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
		if err != nil {
			return nil, err
		}
		if _, err := gzipWriter.Write(publicJSON); err != nil {
			_ = gzipWriter.Close()
			return nil, err
		}
		if err := gzipWriter.Close(); err != nil {
			return nil, err
		}

		hash := sha256.Sum256(publicJSON)
		return &publicResourceCatalogSnapshot{
			modTime:     actual.ModTime(),
			size:        actual.Size(),
			rawItems:    items,
			publicItems: publicItems,
			publicJSON:  publicJSON,
			gzipJSON:    compressed.Bytes(),
			etag:        `W/"resources-` + hex.EncodeToString(hash[:12]) + `"`,
		}, nil
	}
	return nil, fmt.Errorf("resource catalog changed while loading")
}

func (cache *resourceCatalogSnapshotCache) load(path string) (*publicResourceCatalogSnapshot, error) {
	path = normalizedCatalogPath(path)
	info, statErr := os.Stat(path)

	cache.mu.Lock()
	defer cache.mu.Unlock()

	previous := cache.entries[path]
	if statErr == nil && sameCatalogFileVersion(previous, info) {
		return previous, nil
	}
	if statErr != nil {
		if previous != nil {
			if failure, exists := cache.failures[path]; exists && failure.size < 0 && time.Now().Before(failure.retryAfter) {
				return previous, nil
			}
			cache.failures[path] = resourceCatalogLoadFailure{size: -1, retryAfter: time.Now().Add(resourceCatalogRefreshRetryDelay)}
			log.Printf("warn: resource catalog stat failed, serving last-known-good snapshot: %v", statErr)
			return previous, nil
		}
		return nil, statErr
	}
	if failure, exists := cache.failures[path]; previous != nil && exists && failure.size == info.Size() && failure.modTime.Equal(info.ModTime()) && time.Now().Before(failure.retryAfter) {
		return previous, nil
	}

	snapshot, err := buildPublicResourceCatalogSnapshot(path, info)
	if err != nil {
		if previous != nil {
			cache.failures[path] = resourceCatalogLoadFailure{
				modTime:    info.ModTime(),
				size:       info.Size(),
				retryAfter: time.Now().Add(resourceCatalogRefreshRetryDelay),
			}
			log.Printf("warn: resource catalog refresh failed, serving last-known-good snapshot: %v", err)
			return previous, nil
		}
		return nil, err
	}
	cache.entries[path] = snapshot
	delete(cache.failures, path)
	return snapshot, nil
}

// loadResourceCatalog returns the immutable raw catalog snapshot. Callers must
// not mutate the returned slice or maps; all current main-package consumers are
// read-only and catalog writers use service.loadResourceCatalogFile instead.
func loadResourceCatalog(path string) ([]map[string]any, error) {
	snapshot, err := resourceCatalogCache.load(path)
	if err != nil {
		return nil, err
	}
	return snapshot.rawItems, nil
}

func loadPublicResourceCatalogSnapshot(path string) (*publicResourceCatalogSnapshot, error) {
	return resourceCatalogCache.load(path)
}

func appendVary(header http.Header, value string) {
	for _, current := range header.Values("Vary") {
		for _, item := range strings.Split(current, ",") {
			if strings.EqualFold(strings.TrimSpace(item), value) {
				return
			}
		}
	}
	header.Add("Vary", value)
}

func requestAcceptsGzip(value string) bool {
	wildcardAllowed := false
	for _, rawEncoding := range strings.Split(value, ",") {
		parts := strings.Split(rawEncoding, ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			keyValue := strings.SplitN(strings.TrimSpace(parameter), "=", 2)
			if len(keyValue) != 2 || !strings.EqualFold(keyValue[0], "q") {
				continue
			}
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(keyValue[1]), 64); err == nil {
				quality = parsed
			}
		}
		if name == "gzip" {
			return quality > 0
		}
		if name == "*" {
			wildcardAllowed = quality > 0
		}
	}
	return wildcardAllowed
}

func requestETagMatches(value, etag string) bool {
	normalize := func(candidate string) string {
		return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(candidate), "W/"))
	}
	normalizedETag := normalize(etag)
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || normalize(candidate) == normalizedETag {
			return true
		}
	}
	return false
}

func writePublicResourceCatalog(c *gin.Context, snapshot *publicResourceCatalogSnapshot) {
	c.Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
	c.Header("ETag", snapshot.etag)
	appendVary(c.Writer.Header(), "Accept-Encoding")
	if requestETagMatches(c.GetHeader("If-None-Match"), snapshot.etag) {
		c.Status(http.StatusNotModified)
		return
	}
	if requestAcceptsGzip(c.GetHeader("Accept-Encoding")) {
		c.Header("Content-Encoding", "gzip")
		c.Data(http.StatusOK, "application/json; charset=utf-8", snapshot.gzipJSON)
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", snapshot.publicJSON)
}

type resourceCatalogPageQuery struct {
	Page         int
	PageSize     int
	Sort         string
	Keyword      string
	Category     string
	MaterialType string
	ColumnTag    string
	// ColumnKeywords is resolved from the server-owned columnTags file. It is
	// intentionally not populated from URL input so callers cannot alter the
	// meaning of a curated column.
	ColumnKeywords []string
}

type resourceCatalogSortStatistics struct {
	LikeCounts           map[string]int
	WeeklyDownloadCounts map[string]int
	TotalDownloadCounts  map[string]int
}

const resourceCatalogWeeklyTopLimit = 20

type publicResourceCatalogPage struct {
	Success    bool             `json:"success"`
	Items      []map[string]any `json:"items"`
	Page       int              `json:"page"`
	PageSize   int              `json:"pageSize"`
	Total      int              `json:"total"`
	TotalPages int              `json:"totalPages"`
	HasMore    bool             `json:"hasMore"`
}

func parseBoundedPositiveInt(raw string, fallback, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func truncateRunes(value string, maximum int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > maximum {
		runes = runes[:maximum]
	}
	return string(runes)
}

func parseResourceCatalogPageQuery(values url.Values) resourceCatalogPageQuery {
	sortMode := strings.ToLower(strings.TrimSpace(values.Get("sort")))
	switch sortMode {
	case "earliest", "hot", "weeklytop":
	default:
		sortMode = "latest"
	}
	return resourceCatalogPageQuery{
		Page:         parseBoundedPositiveInt(values.Get("page"), 1, 1_000_000),
		PageSize:     parseBoundedPositiveInt(values.Get("pageSize"), 16, 100),
		Sort:         sortMode,
		Keyword:      strings.ToLower(truncateRunes(values.Get("q"), 80)),
		Category:     strings.ToLower(truncateRunes(values.Get("category"), 32)),
		MaterialType: strings.ToLower(truncateRunes(values.Get("materialType"), 32)),
		ColumnTag:    strings.ToLower(truncateRunes(values.Get("columnTag"), 64)),
	}
}

func catalogString(item map[string]any, key string) string {
	value, exists := item[key]
	if !exists || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func catalogStringFilterMatches(actual, requested string) bool {
	requested = strings.TrimSpace(requested)
	if requested == "" || strings.EqualFold(requested, "all") {
		return true
	}
	for _, option := range strings.Split(requested, ",") {
		option = strings.TrimSpace(option)
		if option == "" {
			continue
		}
		if strings.EqualFold(option, "all") || strings.EqualFold(actual, option) {
			return true
		}
	}
	return false
}

func catalogSearchHaystack(item map[string]any) string {
	return strings.ToLower(strings.Join([]string{
		catalogString(item, "title"),
		catalogString(item, "description"),
		catalogString(item, "author"),
	}, "\n"))
}

func resourceCatalogColumnKeywords(rawTags []map[string]any, selectedColumn string) []string {
	selectedColumn = strings.TrimSpace(selectedColumn)
	if selectedColumn == "" || strings.EqualFold(selectedColumn, "all") {
		return nil
	}
	for _, tag := range rawTags {
		if tag == nil || !strings.EqualFold(catalogString(tag, "id"), selectedColumn) {
			continue
		}
		seen := make(map[string]struct{})
		keywords := make([]string, 0)
		appendKeyword := func(raw string) {
			keyword := strings.ToLower(truncateRunes(raw, 80))
			if keyword == "" {
				return
			}
			if _, exists := seen[keyword]; exists {
				return
			}
			seen[keyword] = struct{}{}
			keywords = append(keywords, keyword)
		}
		switch values := tag["keywords"].(type) {
		case []any:
			for _, value := range values {
				appendKeyword(fmt.Sprint(value))
			}
		case []string:
			for _, value := range values {
				appendKeyword(value)
			}
		case string:
			appendKeyword(values)
		}
		return keywords
	}
	return nil
}

func catalogItemMatches(item map[string]any, query resourceCatalogPageQuery) bool {
	if query.Category != "" && query.Category != "all" && !strings.EqualFold(catalogString(item, "category"), query.Category) {
		return false
	}
	if !catalogStringFilterMatches(catalogString(item, "materialType"), query.MaterialType) {
		return false
	}
	var haystack string
	if query.ColumnTag != "" && query.ColumnTag != "all" && !strings.EqualFold(catalogString(item, "columnTag"), query.ColumnTag) {
		haystack = catalogSearchHaystack(item)
		matchedKeyword := false
		for _, keyword := range query.ColumnKeywords {
			if keyword != "" && strings.Contains(haystack, strings.ToLower(keyword)) {
				matchedKeyword = true
				break
			}
		}
		if !matchedKeyword {
			return false
		}
	}
	if query.Keyword == "" {
		return true
	}
	if haystack == "" {
		haystack = catalogSearchHaystack(item)
	}
	return strings.Contains(haystack, query.Keyword)
}

func catalogUpdatedTime(item map[string]any) time.Time {
	raw := catalogString(item, "updatedAt")
	if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return parsed
	}
	// ECMAScript parses date-only values as UTC. Match the previous browser
	// ordering exactly when old date-only and newer RFC3339 entries are mixed.
	if parsed, err := time.Parse("2006-01-02", raw); err == nil {
		return parsed
	}
	chinaTime := time.FixedZone("Asia/Shanghai", 8*60*60)
	for _, layout := range []string{
		"2006/1/2 15:04:05",
		"2006/01/02 15:04:05",
		"2006-01-02 15:04:05",
	} {
		if parsed, err := time.ParseInLocation(layout, raw, chinaTime); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func catalogNumericID(item map[string]any) int64 {
	switch value := item["id"].(type) {
	case int:
		return int64(value)
	case int64:
		return value
	case float64:
		return int64(value)
	case json.Number:
		parsed, _ := value.Int64()
		return parsed
	default:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return parsed
	}
}

func catalogResourceID(item map[string]any) string {
	switch value := item["id"].(type) {
	case string:
		return strings.TrimSpace(value)
	case int:
		return strconv.FormatInt(int64(value), 10)
	case int64:
		return strconv.FormatInt(value, 10)
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return strings.TrimSpace(value.String())
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func cloneNonNegativeCatalogCounts(source map[string]int) map[string]int {
	cloned := make(map[string]int, len(source))
	for id, count := range source {
		if count < 0 {
			count = 0
		}
		cloned[id] = count
	}
	return cloned
}

func nonNegativeCatalogCount(counts map[string]int, resourceID string) int {
	count := counts[resourceID]
	if count < 0 {
		return 0
	}
	return count
}

func buildPublicResourceCatalogPage(items []map[string]any, query resourceCatalogPageQuery) publicResourceCatalogPage {
	return buildPublicResourceCatalogPageWithStatistics(items, query, resourceCatalogSortStatistics{})
}

func buildPublicResourceCatalogPageWithStatistics(items []map[string]any, query resourceCatalogPageQuery, statistics resourceCatalogSortStatistics) publicResourceCatalogPage {
	type candidate struct {
		item            map[string]any
		resourceID      string
		updatedAt       time.Time
		id              int64
		likeCount       int
		weeklyDownloads int
		totalDownloads  int
	}
	filtered := make([]candidate, 0, len(items))
	for _, item := range items {
		if item != nil && catalogItemMatches(item, query) {
			resourceID := catalogResourceID(item)
			filtered = append(filtered, candidate{
				item:            item,
				resourceID:      resourceID,
				updatedAt:       catalogUpdatedTime(item),
				id:              catalogNumericID(item),
				likeCount:       nonNegativeCatalogCount(statistics.LikeCounts, resourceID),
				weeklyDownloads: nonNegativeCatalogCount(statistics.WeeklyDownloadCounts, resourceID),
				totalDownloads:  nonNegativeCatalogCount(statistics.TotalDownloadCounts, resourceID),
			})
		}
	}
	sort.SliceStable(filtered, func(left, right int) bool {
		leftItem := filtered[left]
		rightItem := filtered[right]
		switch query.Sort {
		case "hot":
			if leftItem.likeCount != rightItem.likeCount {
				return leftItem.likeCount > rightItem.likeCount
			}
		case "weeklytop":
			if leftItem.weeklyDownloads != rightItem.weeklyDownloads {
				return leftItem.weeklyDownloads > rightItem.weeklyDownloads
			}
			if leftItem.totalDownloads != rightItem.totalDownloads {
				return leftItem.totalDownloads > rightItem.totalDownloads
			}
		}
		leftTime := filtered[left].updatedAt
		rightTime := filtered[right].updatedAt
		if !leftTime.Equal(rightTime) {
			if query.Sort == "earliest" {
				return leftTime.Before(rightTime)
			}
			return leftTime.After(rightTime)
		}
		leftID := filtered[left].id
		rightID := filtered[right].id
		if query.Sort == "earliest" {
			return leftID < rightID
		}
		return leftID > rightID
	})
	if query.Sort == "weeklytop" && len(filtered) > resourceCatalogWeeklyTopLimit {
		filtered = filtered[:resourceCatalogWeeklyTopLimit]
	}

	total := len(filtered)
	totalPages := 0
	if total > 0 {
		totalPages = (total + query.PageSize - 1) / query.PageSize
	}
	start := (query.Page - 1) * query.PageSize
	if start > total {
		start = total
	}
	end := start + query.PageSize
	if end > total {
		end = total
	}
	pageItems := make([]map[string]any, 0, end-start)
	for _, item := range filtered[start:end] {
		pageItems = append(pageItems, item.item)
	}
	return publicResourceCatalogPage{
		Success:    true,
		Items:      pageItems,
		Page:       query.Page,
		PageSize:   query.PageSize,
		Total:      total,
		TotalPages: totalPages,
		HasMore:    end < total,
	}
}

func resourceCatalogPageETag(base string, query resourceCatalogPageQuery) string {
	digest := sha256.New()
	_, _ = fmt.Fprintf(digest, "page-v2|%s|%d|%d|%s|%s|%s|%s|%s", base, query.Page, query.PageSize, query.Sort, query.Keyword, query.Category, query.MaterialType, query.ColumnTag)
	for _, keyword := range query.ColumnKeywords {
		_, _ = fmt.Fprintf(digest, "|column-keyword:%d:%s", len(keyword), keyword)
	}
	sum := digest.Sum(nil)
	return `W/"resources-page-` + hex.EncodeToString(sum[:12]) + `"`
}

func resourceCatalogPageUsesDynamicStatistics(sortMode string) bool {
	return sortMode == "hot" || sortMode == "weeklytop"
}

func resourceCatalogPageCacheControl(sortMode string) string {
	if resourceCatalogPageUsesDynamicStatistics(sortMode) {
		// Dynamic rankings can change without the catalog file changing. Avoid an
		// O(N log N) statistics digest on every request and never cache their body.
		return "private, no-store"
	}
	return "private, max-age=60, stale-while-revalidate=300"
}
