package service

import (
	"context"
	"testing"
	"time"
)

func TestNormalizeUserVideoTitle(t *testing.T) {
	got := normalizeUserVideoTitle("", "", "vid_20260101120000_abcd1234.mp4")
	if got == "" {
		t.Fatal("expected non-empty title")
	}
	if got := normalizeUserVideoTitle("我的视频", "", ""); got != "我的视频" {
		t.Fatalf("expected 我的视频, got %q", got)
	}
}

func TestVideoUploadSessionConsume(t *testing.T) {
	store := NewVideoUploadSessionStore()
	store.mu.Lock()
	store.sessions["sess1"] = VideoUploadSession{
		ID:        "sess1",
		Serial:    "ABC123",
		CreatedAt: time.Now(),
	}
	store.mu.Unlock()

	if _, err := store.Consume("sess1", "ABC123"); err != nil {
		t.Fatalf("consume failed: %v", err)
	}
	if _, err := store.Consume("sess1", "ABC123"); err == nil {
		t.Fatal("expected consume to fail after deletion")
	}
	if _, err := store.Consume("sess1", "OTHER"); err == nil {
		t.Fatal("expected serial mismatch error")
	}
}

func TestCreateVideoUploadSessionRejectsNonVideo(t *testing.T) {
	store := NewVideoUploadSessionStore()
	_, err := CreateVideoUploadSession(
		context.Background(),
		store,
		CreateVideoUploadSessionInput{
			Serial:      "ABC",
			FileName:    "demo.gif",
			FileSize:    1024,
			VideoSigner: &COSSigner{},
			CoverSigner: &COSSigner{},
		},
	)
	if err == nil {
		t.Fatal("expected error for non-video file")
	}
}
