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

func TestVideoUploadSessionDeleteForSerial(t *testing.T) {
	store := NewVideoUploadSessionStore()
	store.mu.Lock()
	store.sessions["b"] = VideoUploadSession{ID: "b", Serial: "TARGET", CreatedAt: time.Now()}
	store.sessions["a"] = VideoUploadSession{ID: "a", Serial: "target", CreatedAt: time.Now()}
	store.sessions["other"] = VideoUploadSession{ID: "other", Serial: "OTHER", CreatedAt: time.Now()}
	store.mu.Unlock()

	removed := store.DeleteForSerial(" target ")
	if len(removed) != 2 {
		t.Fatalf("expected two removed sessions, got %d", len(removed))
	}
	if removed[0].ID != "a" || removed[1].ID != "b" {
		t.Fatalf("expected deterministic id order, got %+v", removed)
	}
	if _, err := store.Get("other", "OTHER"); err != nil {
		t.Fatalf("unrelated session was removed: %v", err)
	}
	if _, err := store.Get("a", "TARGET"); err == nil {
		t.Fatal("deleted session should no longer be usable")
	}
	if got := store.DeleteSessionsForSerial("target"); len(got) != 0 {
		t.Fatalf("second deletion should be idempotent, got %d", len(got))
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
