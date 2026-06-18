package service

import (
	"context"
	"testing"
	"time"
)

func TestNormalizeUserGifTitle(t *testing.T) {
	got := normalizeUserGifTitle("", "", "gif_20260101120000_abcd1234.gif")
	if got == "" {
		t.Fatal("expected non-empty title")
	}
	if got := normalizeUserGifTitle("我的 GIF", "", ""); got != "我的 GIF" {
		t.Fatalf("expected 我的 GIF, got %q", got)
	}
}

func TestGifUploadSessionConsume(t *testing.T) {
	store := NewGifUploadSessionStore()
	store.mu.Lock()
	store.sessions["sess1"] = GifUploadSession{
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

func TestCreateGifUploadSessionRejectsNonGif(t *testing.T) {
	store := NewGifUploadSessionStore()
	_, err := CreateGifUploadSession(
		context.Background(),
		store,
		CreateGifUploadSessionInput{
			Serial:   "ABC",
			FileName: "demo.mp4",
			FileSize: 1024,
			GifSigner: &COSSigner{},
			CoverSigner: &COSSigner{},
		},
	)
	if err == nil {
		t.Fatal("expected error for non-gif file")
	}
}
