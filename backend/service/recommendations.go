package service

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ResourceInteractionView     = "view"
	ResourceInteractionDownload = "download"
	ResourceInteractionTransfer = "transfer"
)

type ResourceInteraction struct {
	ResourceID  string `json:"resourceId"`
	Action      string `json:"action"`
	ActionCount int    `json:"actionCount"`
	LastAt      int64  `json:"lastAt"`
}

type RecommendationSignals struct {
	Liked           map[string]bool
	Favorites       map[string]int64
	Interactions    []ResourceInteraction
	LikeCounts      map[string]int
	FavoriteCounts  map[string]int
	TotalDownloads  map[string]int
	WeeklyDownloads map[string]int
}

type Recommendation struct {
	ResourceID string  `json:"resourceId"`
	Score      float64 `json:"score"`
	Reason     string  `json:"reason"`
}

type recommendationResource struct {
	id           string
	title        string
	author       string
	columnTag    string
	materialType string
	updatedAt    time.Time
}

type scoredRecommendation struct {
	Recommendation
	resource recommendationResource
}

func IsResourceInteractionAction(action string) bool {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case ResourceInteractionView, ResourceInteractionDownload, ResourceInteractionTransfer:
		return true
	default:
		return false
	}
}

// BuildResourceRecommendations produces deterministic, explainable recommendations.
// It learns coarse preferences from the current device only and blends them with
// global popularity/freshness so a new device still receives useful results.
func BuildResourceRecommendations(catalog []map[string]any, signals RecommendationSignals, limit int, now time.Time) (string, []Recommendation) {
	if limit <= 0 {
		limit = 8
	}
	if limit > 24 {
		limit = 24
	}

	resources := make([]recommendationResource, 0, len(catalog))
	byID := make(map[string]recommendationResource, len(catalog))
	for _, item := range catalog {
		resource, ok := parseRecommendationResource(item)
		if !ok || resource.materialType == "v1pro-pack" {
			continue
		}
		resources = append(resources, resource)
		byID[resource.id] = resource
	}

	tagAffinity := map[string]float64{}
	typeAffinity := map[string]float64{}
	authorAffinity := map[string]float64{}
	excluded := map[string]bool{}
	profileWeight := 0.0
	addProfile := func(resourceID string, weight float64) {
		resource, ok := byID[resourceID]
		if !ok || weight <= 0 {
			return
		}
		if resource.columnTag != "" {
			tagAffinity[resource.columnTag] += weight
		}
		if resource.materialType != "" {
			typeAffinity[resource.materialType] += weight
		}
		if resource.author != "" {
			authorAffinity[resource.author] += weight * 0.55
		}
		profileWeight += weight
	}

	for id, liked := range signals.Liked {
		if liked {
			addProfile(id, 3.0)
			excluded[id] = true
		}
	}
	for id := range signals.Favorites {
		addProfile(id, 5.0)
		excluded[id] = true
	}
	for _, interaction := range signals.Interactions {
		count := interaction.ActionCount
		if count < 1 {
			count = 1
		}
		if count > 5 {
			count = 5
		}
		decay := interactionRecency(interaction.LastAt, now)
		switch interaction.Action {
		case ResourceInteractionView:
			addProfile(interaction.ResourceID, float64(count)*0.8*decay)
		case ResourceInteractionDownload:
			addProfile(interaction.ResourceID, (6.0+float64(count-1))*decay)
			excluded[interaction.ResourceID] = true
		case ResourceInteractionTransfer:
			addProfile(interaction.ResourceID, (8.0+float64(count-1))*decay)
			excluded[interaction.ResourceID] = true
		}
	}

	mode := "personalized"
	if profileWeight < 0.5 {
		mode = "popular"
	}
	scored := make([]scoredRecommendation, 0, len(resources))
	for _, resource := range resources {
		if excluded[resource.id] {
			continue
		}
		weekly := nonNegative(signals.WeeklyDownloads[resource.id])
		total := nonNegative(signals.TotalDownloads[resource.id])
		likes := nonNegative(signals.LikeCounts[resource.id])
		favorites := nonNegative(signals.FavoriteCounts[resource.id])
		popularity := math.Log1p(float64(weekly))*2.6 + math.Log1p(float64(total))*0.8 +
			math.Log1p(float64(likes))*1.2 + math.Log1p(float64(favorites))*1.4
		freshness := recommendationFreshness(resource.updatedAt, now)
		score := popularity + freshness
		reason := "本周热门"
		if mode == "personalized" {
			preference := tagAffinity[resource.columnTag]*1.5 + typeAffinity[resource.materialType]*0.65 + authorAffinity[resource.author]
			score += preference
			switch {
			case resource.columnTag != "" && tagAffinity[resource.columnTag] > 0:
				if strings.HasPrefix(strings.ToLower(resource.columnTag), "col-") {
					reason = "与你喜欢的素材相似"
				} else {
					reason = "与你喜欢的「" + resource.columnTag + "」相似"
				}
			case resource.author != "" && authorAffinity[resource.author] > 0:
				reason = "你可能喜欢这个作者"
			case typeAffinity[resource.materialType] > 0:
				reason = "符合你的素材偏好"
			case freshness >= 1.5:
				reason = "近期上新"
			}
		} else if freshness >= 1.5 && weekly == 0 {
			reason = "近期上新"
		}
		scored = append(scored, scoredRecommendation{
			Recommendation: Recommendation{ResourceID: resource.id, Score: math.Round(score*100) / 100, Reason: reason},
			resource:       resource,
		})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].Score != scored[j].Score {
			return scored[i].Score > scored[j].Score
		}
		if !scored[i].resource.updatedAt.Equal(scored[j].resource.updatedAt) {
			return scored[i].resource.updatedAt.After(scored[j].resource.updatedAt)
		}
		return scored[i].ResourceID < scored[j].ResourceID
	})

	selected := diversifyRecommendations(scored, limit)
	result := make([]Recommendation, 0, len(selected))
	for _, item := range selected {
		result = append(result, item.Recommendation)
	}
	return mode, result
}

func diversifyRecommendations(scored []scoredRecommendation, limit int) []scoredRecommendation {
	result := make([]scoredRecommendation, 0, limit)
	selected := map[string]bool{}
	authorCounts := map[string]int{}
	tagCounts := map[string]int{}
	for _, item := range scored {
		if len(result) >= limit {
			break
		}
		if item.resource.author != "" && authorCounts[item.resource.author] >= 2 {
			continue
		}
		if item.resource.columnTag != "" && tagCounts[item.resource.columnTag] >= 3 {
			continue
		}
		result = append(result, item)
		selected[item.ResourceID] = true
		authorCounts[item.resource.author]++
		tagCounts[item.resource.columnTag]++
	}
	for _, item := range scored {
		if len(result) >= limit {
			break
		}
		if selected[item.ResourceID] {
			continue
		}
		result = append(result, item)
	}
	return result
}

func parseRecommendationResource(item map[string]any) (recommendationResource, bool) {
	id := recommendationString(item["id"])
	category := strings.ToLower(recommendationString(item["category"]))
	materialType := strings.ToLower(recommendationString(item["materialType"]))
	if id == "" || category != "gif" || (materialType != "image" && materialType != "video" && materialType != "gif") {
		return recommendationResource{}, false
	}
	updatedAt, _ := time.Parse(time.RFC3339, recommendationString(item["updatedAt"]))
	if updatedAt.IsZero() {
		updatedAt, _ = time.Parse("2006-01-02", recommendationString(item["updatedAt"]))
	}
	return recommendationResource{
		id:           id,
		title:        recommendationString(item["title"]),
		author:       strings.ToLower(recommendationString(item["author"])),
		columnTag:    recommendationString(item["columnTag"]),
		materialType: materialType,
		updatedAt:    updatedAt,
	}, true
}

func recommendationString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case jsonNumber:
		return string(typed)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

// jsonNumber mirrors encoding/json.Number without coupling callers to decoder options.
type jsonNumber string

func recommendationFreshness(updatedAt, now time.Time) float64 {
	if updatedAt.IsZero() || now.Before(updatedAt) {
		return 0
	}
	days := now.Sub(updatedAt).Hours() / 24
	return 2.2 * math.Exp(-days/45)
}

func interactionRecency(lastAt int64, now time.Time) float64 {
	if lastAt <= 0 {
		return 0.65
	}
	ageDays := now.Sub(time.Unix(lastAt, 0)).Hours() / 24
	if ageDays <= 0 {
		return 1
	}
	return math.Max(0.25, math.Exp(-ageDays/90))
}

func nonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}
