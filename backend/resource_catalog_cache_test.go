package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func resetResourceCatalogCacheForTest() {
	resourceCatalogCache.mu.Lock()
	resourceCatalogCache.entries = make(map[string]*publicResourceCatalogSnapshot)
	resourceCatalogCache.failures = make(map[string]resourceCatalogLoadFailure)
	resourceCatalogCache.mu.Unlock()
}

func writeCatalogFixture(t *testing.T, path, body string, modTime time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatal(err)
	}
}

func TestResourceCatalogSnapshotCachesSanitizedPayloadAndRefreshes(t *testing.T) {
	resetResourceCatalogCacheForTest()
	path := filepath.Join(t.TempDir(), "resources.json")
	firstModTime := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	writeCatalogFixture(t, path, `[{"id":1,"title":"first","description":"d","image":"https://cos.example/a.gif","download":"https://cos.example/private.bin","category":"gif","materialType":"gif","updatedAt":"2026-08-01","uploaderSerial":"SECRET","_uploaderSerial":"LEGACY-SECRET"}]`, firstModTime)

	first, err := loadPublicResourceCatalogSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadPublicResourceCatalogSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("unchanged catalog should reuse the same snapshot")
	}
	if strings.Contains(string(first.publicJSON), "SECRET") || strings.Contains(string(first.publicJSON), "private.bin") {
		t.Fatalf("public payload leaked private fields: %s", first.publicJSON)
	}
	if !strings.Contains(string(first.publicJSON), `"image":"a.gif"`) {
		t.Fatalf("public image URL was not converted to an object key: %s", first.publicJSON)
	}
	if len(first.gzipJSON) >= len(first.publicJSON) {
		t.Fatal("expected gzip payload to be smaller than identity payload")
	}

	secondModTime := firstModTime.Add(time.Minute)
	writeCatalogFixture(t, path, `[{"id":2,"title":"second","description":"d","image":"b.gif","category":"gif","materialType":"gif","updatedAt":"2026-08-02"}]`, secondModTime)
	refreshed, err := loadPublicResourceCatalogSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed == first || !strings.Contains(string(refreshed.publicJSON), `"title":"second"`) {
		t.Fatal("changed catalog did not refresh")
	}

	writeCatalogFixture(t, path, `{`, secondModTime.Add(time.Minute))
	lastGood, err := loadPublicResourceCatalogSnapshot(path)
	if err != nil {
		t.Fatalf("expected last-known-good snapshot, got %v", err)
	}
	if lastGood != refreshed {
		t.Fatal("invalid refresh should keep the last-known-good snapshot")
	}
	resourceCatalogCache.mu.Lock()
	_, failureRemembered := resourceCatalogCache.failures[normalizedCatalogPath(path)]
	resourceCatalogCache.mu.Unlock()
	if !failureRemembered {
		t.Fatal("invalid catalog version should be remembered for retry backoff")
	}
	secondLastGood, err := loadPublicResourceCatalogSnapshot(path)
	if err != nil || secondLastGood != refreshed {
		t.Fatal("retry backoff should keep serving the last-known-good snapshot")
	}
}

func TestResourceCatalogSnapshotConcurrentLoad(t *testing.T) {
	resetResourceCatalogCacheForTest()
	path := filepath.Join(t.TempDir(), "resources.json")
	writeCatalogFixture(t, path, `[{"id":1,"title":"first","description":"d","image":"a.gif","category":"gif","materialType":"gif","updatedAt":"2026-08-01"}]`, time.Now().Add(-time.Hour))

	var wait sync.WaitGroup
	errors := make(chan error, 64)
	for index := 0; index < 64; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := loadPublicResourceCatalogSnapshot(path)
			errors <- err
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestWritePublicResourceCatalogSupportsGzipETagAndVary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	snapshot := &publicResourceCatalogSnapshot{
		publicJSON: []byte(`[{"id":1}]`),
		etag:       `W/"resources-test"`,
	}
	var compressed strings.Builder
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(snapshot.publicJSON); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot.gzipJSON = []byte(compressed.String())

	router := gin.New()
	router.GET("/api/resources", func(c *gin.Context) {
		c.Writer.Header().Add("Vary", "Origin")
		writePublicResourceCatalog(c, snapshot)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	req.Header.Set("Accept-Encoding", "br, gzip")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip 200, got status=%d encoding=%q", rec.Code, rec.Header().Get("Content-Encoding"))
	}
	if len(rec.Header().Values("Vary")) < 2 {
		t.Fatalf("expected Origin and Accept-Encoding Vary values, got %v", rec.Header().Values("Vary"))
	}
	gzipReader, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(gzipReader)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(snapshot.publicJSON) {
		t.Fatalf("decoded payload mismatch: %s", decoded)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	req.Header.Set("Accept-Encoding", "gzip;q=0, *;q=1")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != string(snapshot.publicJSON) {
		t.Fatal("gzip;q=0 must return the identity representation")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	// Weak comparison must work across the identity and gzip representations.
	req.Header.Set("If-None-Match", `"resources-test"`)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatalf("expected empty 304 response, got status=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestCatalogNumericIDPreservesProductionSizedIDs(t *testing.T) {
	const resourceID int64 = 2608232258233170
	if actual := catalogNumericID(map[string]any{"id": float64(resourceID)}); actual != resourceID {
		t.Fatalf("catalogNumericID() = %d, want %d", actual, resourceID)
	}
	if actual := catalogResourceID(map[string]any{"id": float64(resourceID)}); actual != "2608232258233170" {
		t.Fatalf("catalogResourceID() = %q, want decimal production id", actual)
	}
}

func TestBuildPublicResourceCatalogPageFiltersAndSorts(t *testing.T) {
	items := []map[string]any{
		{"id": float64(1), "title": "Alpha", "description": "first", "author": "A", "category": "gif", "materialType": "image", "columnTag": "doro", "updatedAt": "2026/5/31 1:19:01"},
		{"id": float64(2), "title": "Beta", "description": "second", "author": "B", "category": "gif", "materialType": "video", "columnTag": "other", "updatedAt": "2026-08-02T10:00:00+08:00"},
		{"id": float64(3), "title": "Alpha newest", "description": "third", "author": "C", "category": "gif", "materialType": "image", "columnTag": "doro", "updatedAt": "2026-08-03"},
	}
	query := parseResourceCatalogPageQuery(url.Values{
		"page":         []string{"1"},
		"pageSize":     []string{"1"},
		"sort":         []string{"latest"},
		"q":            []string{"alpha"},
		"materialType": []string{"image"},
		"columnTag":    []string{"doro"},
	})
	page := buildPublicResourceCatalogPage(items, query)
	if page.Total != 2 || page.TotalPages != 2 || !page.HasMore || len(page.Items) != 1 {
		encoded, _ := json.Marshal(page)
		t.Fatalf("unexpected page metadata: %s", encoded)
	}
	if catalogNumericID(page.Items[0]) != 3 {
		t.Fatalf("latest item should be id=3, got %v", page.Items[0]["id"])
	}
}

func TestResourceCatalogDateOnlySortMatchesBrowserUTCParsing(t *testing.T) {
	items := []map[string]any{
		{"id": float64(1), "category": "gif", "materialType": "gif", "updatedAt": "2026-08-03"},
		{"id": float64(2), "category": "gif", "materialType": "gif", "updatedAt": "2026-08-03T04:00:00+08:00"},
	}
	page := buildPublicResourceCatalogPage(items, parseResourceCatalogPageQuery(url.Values{"sort": []string{"latest"}}))
	if got := catalogResourceID(page.Items[0]); got != "1" {
		t.Fatalf("date-only value must follow browser UTC semantics, first id=%s want 1", got)
	}
}

func TestResourceCatalogPageSupportsDynamicSortsAndMaterialTypeList(t *testing.T) {
	items := []map[string]any{
		{"id": float64(1), "title": "image", "category": "gif", "materialType": "image", "updatedAt": "2026-08-04"},
		{"id": float64(2), "title": "gif", "category": "gif", "materialType": "gif", "updatedAt": "2026-08-03"},
		{"id": float64(3), "title": "video", "category": "gif", "materialType": "video", "updatedAt": "2026-08-02"},
	}
	hotQuery := parseResourceCatalogPageQuery(url.Values{
		"sort":         []string{"hot"},
		"materialType": []string{"video,gif"},
	})
	hotPage := buildPublicResourceCatalogPageWithStatistics(items, hotQuery, resourceCatalogSortStatistics{
		LikeCounts: map[string]int{"1": 100, "2": 4, "3": 8},
	})
	if hotPage.Total != 2 || len(hotPage.Items) != 2 {
		t.Fatalf("hot material list should contain only video and gif items: %#v", hotPage)
	}
	if got := catalogResourceID(hotPage.Items[0]); got != "3" {
		t.Fatalf("hot order should use like counts, first id=%s want 3", got)
	}

	weeklyQuery := parseResourceCatalogPageQuery(url.Values{"sort": []string{"weeklyTop"}})
	weeklyPage := buildPublicResourceCatalogPageWithStatistics(items, weeklyQuery, resourceCatalogSortStatistics{
		WeeklyDownloadCounts: map[string]int{"1": 5, "2": 5, "3": 6},
		TotalDownloadCounts:  map[string]int{"1": 100, "2": 200, "3": 1},
	})
	want := []string{"3", "2", "1"}
	for index, item := range weeklyPage.Items {
		if got := catalogResourceID(item); got != want[index] {
			t.Fatalf("weekly order[%d]=%s want %s", index, got, want[index])
		}
	}
}

func TestResourceCatalogWeeklyTopRetainsLegacyTwentyItemLimit(t *testing.T) {
	items := make([]map[string]any, 0, 25)
	weeklyCounts := make(map[string]int, 25)
	for id := 1; id <= 25; id++ {
		resourceID := strconv.Itoa(id)
		items = append(items, map[string]any{
			"id":           float64(id),
			"category":     "gif",
			"materialType": "gif",
			"updatedAt":    "2026-08-01",
		})
		weeklyCounts[resourceID] = id
	}
	query := parseResourceCatalogPageQuery(url.Values{
		"sort":     []string{"weeklyTop"},
		"pageSize": []string{"100"},
	})
	page := buildPublicResourceCatalogPageWithStatistics(items, query, resourceCatalogSortStatistics{
		WeeklyDownloadCounts: weeklyCounts,
	})
	if page.Total != resourceCatalogWeeklyTopLimit || len(page.Items) != resourceCatalogWeeklyTopLimit || page.HasMore {
		t.Fatalf("weekly top should expose exactly %d results: %#v", resourceCatalogWeeklyTopLimit, page)
	}
	if got := catalogResourceID(page.Items[0]); got != "25" {
		t.Fatalf("weekly top first id=%s want 25", got)
	}
}

func TestResourceCatalogColumnMatchingUsesServerResolvedKeywords(t *testing.T) {
	rawTags := []map[string]any{
		{"id": "doro", "keywords": []any{"Doro", "多洛"}},
	}
	query := parseResourceCatalogPageQuery(url.Values{"columnTag": []string{"doro"}})
	query.ColumnKeywords = resourceCatalogColumnKeywords(rawTags, query.ColumnTag)
	items := []map[string]any{
		{"id": float64(1), "title": "legacy DORO animation", "category": "gif", "materialType": "gif"},
		{"id": float64(2), "title": "direct tag", "category": "gif", "materialType": "gif", "columnTag": "doro"},
		{"id": float64(3), "title": "unrelated", "category": "gif", "materialType": "gif"},
	}
	page := buildPublicResourceCatalogPage(items, query)
	if page.Total != 2 {
		t.Fatalf("column should match direct tag or curated keyword, got total=%d", page.Total)
	}
}

func TestResourceCatalogETagAndCacheSemantics(t *testing.T) {
	hotQuery := parseResourceCatalogPageQuery(url.Values{"sort": []string{"hot"}})
	if !resourceCatalogPageUsesDynamicStatistics(hotQuery.Sort) {
		t.Fatal("hot must be treated as a dynamic statistics sort")
	}
	if got := resourceCatalogPageCacheControl(hotQuery.Sort); !strings.Contains(got, "no-store") {
		t.Fatalf("hot responses must not be cached: %q", got)
	}

	latestQuery := parseResourceCatalogPageQuery(url.Values{"sort": []string{"latest"}})
	if resourceCatalogPageUsesDynamicStatistics(latestQuery.Sort) {
		t.Fatal("latest must remain catalog-cacheable")
	}
	firstLatestETag := resourceCatalogPageETag(`W/"catalog"`, latestQuery)

	latestQuery.ColumnKeywords = []string{"doro"}
	columnETag := resourceCatalogPageETag(`W/"catalog"`, latestQuery)
	if columnETag == firstLatestETag {
		t.Fatal("ETag must include server-resolved column keywords")
	}
}
