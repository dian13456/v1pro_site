package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
