package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFilterCatalogByUploaderSerial(t *testing.T) {
	items := []map[string]any{
		{"id": 1, "title": "mine", "uploaderSerial": "abc123"},
		{"id": 2, "title": "other", "uploaderSerial": "xyz"},
		{"id": 3, "title": "mine-upper", "uploaderSerial": "ABC123"},
	}
	got := FilterCatalogByUploaderSerial(items, "abc123")
	if len(got) != 2 {
		t.Fatalf("expected 2 items, got %d", len(got))
	}
}

func TestListDeviceUploadReviews(t *testing.T) {
	store := ImageReviewStore{
		Items: []PendingImageReview{
			{ID: "r1", Serial: "sn1", Action: ReviewActionShareUser, Status: ImageReviewStatusPending, Title: "图片", CreatedAt: "2026-01-02T10:00:00Z", ImageObjectKey: "img.jpg"},
			{ID: "r2", Serial: "sn1", Action: ReviewActionShareUserVideo, Status: ImageReviewStatusPending, Title: "视频", CreatedAt: "2026-01-03T10:00:00Z", CoverObjectKey: "cover.jpg"},
			{ID: "r3", Serial: "sn2", Action: ReviewActionShareUser, Status: ImageReviewStatusPending, Title: "other", CreatedAt: "2026-01-04T10:00:00Z"},
			{ID: "r4", Serial: "sn1", Action: ReviewActionGenerate, Status: ImageReviewStatusPending, Title: "skip", CreatedAt: "2026-01-05T10:00:00Z"},
			{ID: "r5", Serial: "sn1", Action: ReviewActionShareUserGif, Status: ImageReviewStatusRejected, Title: "gif", CreatedAt: "2026-01-01T10:00:00Z", ReviewNote: "不合规"},
		},
	}
	got := ListDeviceUploadReviews(&store, "SN1")
	if len(got) != 3 {
		t.Fatalf("expected 3 review items, got %d", len(got))
	}
	if got[0]["reviewId"] != "r2" {
		t.Fatalf("expected newest review first, got %#v", got[0]["reviewId"])
	}
	if got[2]["status"] != ImageReviewStatusRejected {
		t.Fatalf("expected rejected item last in sorted list")
	}
}

func TestRemoveDeviceReviewUpload(t *testing.T) {
	store := ImageReviewStore{
		Items: []PendingImageReview{
			{ID: "r1", Serial: "sn1", Action: ReviewActionShareUser, Status: ImageReviewStatusPending},
			{ID: "r2", Serial: "sn2", Action: ReviewActionShareUser, Status: ImageReviewStatusPending},
		},
	}
	if _, err := RemoveDeviceReviewUpload(&store, "r1", "sn2"); err == nil {
		t.Fatal("expected permission error")
	}
	item, err := RemoveDeviceReviewUpload(&store, "r1", "sn1")
	if err != nil {
		t.Fatalf("remove failed: %v", err)
	}
	if item.ID != "r1" || len(store.Items) != 1 {
		t.Fatalf("unexpected store after remove: %#v", store.Items)
	}
}

func TestUpdateOwnPublishedUploadTitle(t *testing.T) {
	dir := t.TempDir()
	resourcesPath := filepath.Join(dir, "resources.json")
	resources := []map[string]any{
		{"id": 1001, "title": "旧标题", "uploaderSerial": "sn1", "updatedAt": "2026-01-01T00:00:00Z"},
	}
	raw, _ := json.Marshal(resources)
	if err := os.WriteFile(resourcesPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := UpdateOwnPublishedUploadTitle("SN1", 1001, "  新标题  ", resourcesPath); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	updated, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		t.Fatal(err)
	}
	if updated[0]["title"] != "新标题" {
		t.Fatalf("unexpected title: %#v", updated[0]["title"])
	}
	if err := UpdateOwnPublishedUploadTitle("SN2", 1001, "越权", resourcesPath); err == nil {
		t.Fatal("expected ownership error")
	}
}

func TestUpdateOwnReviewUploadTitle(t *testing.T) {
	store := ImageReviewStore{Items: []PendingImageReview{
		{ID: "r1", Serial: "sn1", Action: ReviewActionShareUserGif, Status: ImageReviewStatusPending, Title: "旧标题"},
	}}
	if err := UpdateOwnReviewUploadTitle(&store, "r1", "SN1", "新标题"); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if store.Items[0].Title != "新标题" {
		t.Fatalf("unexpected title: %q", store.Items[0].Title)
	}
	if err := UpdateOwnReviewUploadTitle(&store, "r1", "SN2", "越权"); err == nil {
		t.Fatal("expected ownership error")
	}
	if _, err := ValidateUploadTitle(strings.Repeat("题", 81)); err == nil {
		t.Fatal("expected title length error")
	}
}

func TestDeleteOwnPublishedUploadVideo(t *testing.T) {
	dir := t.TempDir()
	resourcesPath := filepath.Join(dir, "resources.json")
	resourceMapPath := filepath.Join(dir, "resource_map.json")
	imageMapPath := filepath.Join(dir, "image_map.json")

	resources := []map[string]any{
		{
			"id":             2607031234567890,
			"title":          "my video",
			"description":    "demo",
			"size":           "1MB",
			"image":          "cover_260703.jpg",
			"download":       "vid_260703.mp4",
			"category":       "gif",
			"materialType":   "video",
			"updatedAt":      "2026-01-01T00:00:00Z",
			"uploaderSerial": "abc123",
		},
	}
	raw, err := json.Marshal(resources)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcesPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourceMapPath, []byte(`{"2607031234567890":"vid_260703.mp4"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imageMapPath, []byte(`{"2607031234567890":"cover_260703.jpg"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := DeleteOwnPublishedUpload(context.Background(), DeleteOwnPublishedUploadInput{
		Serial:          "abc123",
		ResourceID:      2607031234567890,
		ResourcesPath:   resourcesPath,
		ResourceMapPath: resourceMapPath,
		ImageMapPath:    imageMapPath,
	}); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	remaining, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("expected empty catalog, got %#v", remaining)
	}
}

func TestDeleteOwnReviewUploadRemovesApprovedPublishedVideo(t *testing.T) {
	dir := t.TempDir()
	resourcesPath := filepath.Join(dir, "resources.json")
	resourceMapPath := filepath.Join(dir, "resource_map.json")
	imageMapPath := filepath.Join(dir, "image_map.json")

	resources := []map[string]any{
		{
			"id":             2607031234567890,
			"title":          "my video",
			"description":    "demo",
			"size":           "1MB",
			"image":          "cover_260703.jpg",
			"download":       "vid_260703.mp4",
			"category":       "gif",
			"materialType":   "video",
			"updatedAt":      "2026-01-01T00:00:00Z",
			"uploaderSerial": "abc123",
		},
	}
	raw, err := json.Marshal(resources)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcesPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourceMapPath, []byte(`{"2607031234567890":"vid_260703.mp4"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imageMapPath, []byte(`{"2607031234567890":"cover_260703.jpg"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	store := ImageReviewStore{
		Items: []PendingImageReview{
			{
				ID:             "rev-video",
				Serial:         "abc123",
				Action:         ReviewActionShareUserVideo,
				Status:         ImageReviewStatusApproved,
				Title:          "my video",
				GifObjectKey:   "vid_260703.mp4",
				CoverObjectKey: "cover_260703.jpg",
			},
		},
	}

	result, err := DeleteOwnReviewUpload(context.Background(), DeleteOwnReviewUploadInput{
		Store:           &store,
		ReviewID:        "rev-video",
		Serial:          "abc123",
		ResourcesPath:   resourcesPath,
		ResourceMapPath: resourceMapPath,
		ImageMapPath:    imageMapPath,
	})
	if err != nil {
		t.Fatalf("delete review failed: %v", err)
	}
	if result.DeletedResourceID != 2607031234567890 {
		t.Fatalf("expected published resource to be deleted, got %d", result.DeletedResourceID)
	}
	if len(store.Items) != 0 {
		t.Fatalf("expected review queue to be empty, got %#v", store.Items)
	}
	remaining, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("expected catalog to be empty, got %#v", remaining)
	}
}

func TestRemoveDeviceReviewUploadAllowsApproved(t *testing.T) {
	store := ImageReviewStore{
		Items: []PendingImageReview{
			{
				ID:     "r1",
				Serial: "sn1",
				Action: ReviewActionShareUserVideo,
				Status: ImageReviewStatusApproved,
			},
		},
	}
	item, err := RemoveDeviceReviewUpload(&store, "r1", "sn1")
	if err != nil {
		t.Fatalf("remove approved review failed: %v", err)
	}
	if item.ID != "r1" || len(store.Items) != 0 {
		t.Fatalf("unexpected store after remove: %#v", store.Items)
	}
}

func TestDeleteOwnPublishedUpload(t *testing.T) {
	dir := t.TempDir()
	resourcesPath := filepath.Join(dir, "resources.json")
	resourceMapPath := filepath.Join(dir, "resource_map.json")
	imageMapPath := filepath.Join(dir, "image_map.json")

	resources := []map[string]any{
		{
			"id":             1001,
			"title":          "mine",
			"description":    "demo",
			"size":           "1KB",
			"image":          "img_1001.jpg",
			"download":       "img_1001.jpg",
			"category":       "gif",
			"materialType":   "image",
			"updatedAt":      "2026-01-01T00:00:00Z",
			"uploaderSerial": "abc123",
		},
		{
			"id":           1002,
			"title":        "admin",
			"description":  "demo",
			"size":         "1KB",
			"image":        "img_1002.jpg",
			"download":     "img_1002.jpg",
			"category":     "gif",
			"materialType": "image",
			"updatedAt":    "2026-01-01T00:00:00Z",
		},
	}
	raw, err := json.Marshal(resources)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcesPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourceMapPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imageMapPath, []byte(`{"1001":"img_1001.jpg"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := DeleteOwnPublishedUpload(context.Background(), DeleteOwnPublishedUploadInput{
		Serial:          "abc123",
		ResourceID:      1002,
		ResourcesPath:   resourcesPath,
		ResourceMapPath: resourceMapPath,
		ImageMapPath:    imageMapPath,
	}); err == nil {
		t.Fatal("expected permission error for admin item")
	}

	if err := DeleteOwnPublishedUpload(context.Background(), DeleteOwnPublishedUploadInput{
		Serial:          "abc123",
		ResourceID:      1001,
		ResourcesPath:   resourcesPath,
		ResourceMapPath: resourceMapPath,
		ImageMapPath:    imageMapPath,
	}); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	remaining, err := loadResourceCatalogFile(resourcesPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 || stringifyCatalogID(remaining[0]["id"]) != "1002" {
		t.Fatalf("unexpected remaining resources: %#v", remaining)
	}
	imageMap, err := loadStringMapFile(imageMapPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := imageMap["1001"]; ok {
		t.Fatal("image map entry should be removed")
	}
}
