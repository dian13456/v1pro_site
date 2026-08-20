package service

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func recommendationFixture(id int, tag, material, author, updated string) map[string]any {
	return map[string]any{
		"id":           float64(id),
		"title":        "resource",
		"category":     "gif",
		"columnTag":    tag,
		"materialType": material,
		"author":       author,
		"updatedAt":    updated,
	}
}

func TestBuildResourceRecommendationsSupportsLargeCandidatePool(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.Local)
	catalog := make([]map[string]any, 0, 120)
	for index := 1; index <= 120; index++ {
		catalog = append(catalog, recommendationFixture(index, fmt.Sprintf("tag-%d", index%12), "image", fmt.Sprintf("author-%d", index%40), "2026-08-01"))
	}
	_, result := BuildResourceRecommendations(catalog, RecommendationSignals{}, 96, now)
	if len(result) != 96 {
		t.Fatalf("len(result)=%d, want 96", len(result))
	}
}

func TestRotateResourceRecommendationsChangesSeedAndAvoidsRecentItems(t *testing.T) {
	candidates := make([]Recommendation, 0, 192)
	excluded := make(map[string]bool)
	for index := 1; index <= 192; index++ {
		id := fmt.Sprintf("%d", index)
		candidates = append(candidates, Recommendation{ResourceID: id, Score: float64(193 - index)})
		if index <= 16 {
			excluded[id] = true
		}
	}
	first := RotateResourceRecommendations(candidates, 64, "seed-a", excluded)
	second := RotateResourceRecommendations(candidates, 64, "seed-b", excluded)
	if len(first) != 64 || len(second) != 64 {
		t.Fatalf("unexpected lengths: %d and %d", len(first), len(second))
	}
	for _, item := range first {
		if excluded[item.ResourceID] {
			t.Fatalf("recent item %s should not be selected while fresh candidates remain", item.ResourceID)
		}
	}
	firstPage := make([]string, 0, 16)
	secondPage := make([]string, 0, 16)
	for index := 0; index < 16; index++ {
		firstPage = append(firstPage, first[index].ResourceID)
		secondPage = append(secondPage, second[index].ResourceID)
	}
	if reflect.DeepEqual(firstPage, secondPage) {
		t.Fatalf("different seeds produced the same first page: %#v", firstPage)
	}
}

func TestBuildResourceRecommendationsPersonalizesAndExcludesConsumed(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.Local)
	catalog := []map[string]any{
		recommendationFixture(1, "动漫", "gif", "alice", "2026-08-01"),
		recommendationFixture(2, "动漫", "gif", "bob", "2026-08-02"),
		recommendationFixture(3, "风景", "image", "carol", "2026-08-12"),
	}
	mode, result := BuildResourceRecommendations(catalog, RecommendationSignals{
		Favorites: map[string]int64{"1": now.Unix()},
	}, 2, now)
	if mode != "personalized" {
		t.Fatalf("mode = %q, want personalized", mode)
	}
	if len(result) != 2 {
		t.Fatalf("len(result) = %d, want 2", len(result))
	}
	if result[0].ResourceID != "2" {
		t.Fatalf("first recommendation = %q, want similar resource 2", result[0].ResourceID)
	}
	for _, item := range result {
		if item.ResourceID == "1" {
			t.Fatal("already favorited resource should be excluded")
		}
	}
}

func TestBuildResourceRecommendationsColdStartUsesWeeklyPopularity(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.Local)
	catalog := []map[string]any{
		recommendationFixture(1, "动漫", "gif", "alice", "2026-08-01"),
		recommendationFixture(2, "风景", "image", "bob", "2026-08-01"),
	}
	mode, result := BuildResourceRecommendations(catalog, RecommendationSignals{
		WeeklyDownloads: map[string]int{"2": 50},
	}, 1, now)
	if mode != "popular" {
		t.Fatalf("mode = %q, want popular", mode)
	}
	if len(result) != 1 || result[0].ResourceID != "2" {
		t.Fatalf("result = %#v, want weekly popular resource 2", result)
	}
}

func TestBuildResourceRecommendationsDownloadBuildsProfileAndExcludesSource(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.Local)
	catalog := []map[string]any{
		recommendationFixture(1, "机甲", "video", "alice", "2026-08-01"),
		recommendationFixture(2, "机甲", "video", "bob", "2026-07-01"),
		recommendationFixture(3, "风景", "image", "carol", "2026-08-12"),
	}
	_, result := BuildResourceRecommendations(catalog, RecommendationSignals{
		Interactions: []ResourceInteraction{{ResourceID: "1", Action: ResourceInteractionDownload, ActionCount: 1, LastAt: now.Unix()}},
	}, 2, now)
	if len(result) == 0 || result[0].ResourceID != "2" {
		t.Fatalf("result = %#v, want resource 2 first", result)
	}
	for _, item := range result {
		if item.ResourceID == "1" {
			t.Fatal("downloaded resource should be excluded")
		}
	}
}

func TestBuildResourceRecommendationsDiversifiesAuthors(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.Local)
	catalog := []map[string]any{
		recommendationFixture(1, "A", "image", "same", "2026-08-12"),
		recommendationFixture(2, "B", "image", "same", "2026-08-11"),
		recommendationFixture(3, "C", "image", "same", "2026-08-10"),
		recommendationFixture(4, "D", "image", "different", "2026-08-01"),
	}
	_, result := BuildResourceRecommendations(catalog, RecommendationSignals{}, 3, now)
	if len(result) != 3 {
		t.Fatalf("len(result) = %d, want 3", len(result))
	}
	foundDifferent := false
	for _, item := range result {
		if item.ResourceID == "4" {
			foundDifferent = true
		}
	}
	if !foundDifferent {
		t.Fatalf("result = %#v, expected diversified author", result)
	}
}
