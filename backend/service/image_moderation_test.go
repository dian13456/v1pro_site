package service

import (
	"errors"
	"testing"
)

func TestImageModerationClientUnavailableSkips(t *testing.T) {
	client := &ImageModerationClient{Enabled: false}
	if err := client.ModerateImageBytes(nil, []byte("1234567890123456"), "test", "IMAGE"); err != nil {
		t.Fatalf("expected skip, got %v", err)
	}
}

func TestNewImageModerationClientInitializesSDK(t *testing.T) {
	client, err := NewImageModerationClient("test-id", "test-key", "ap-guangzhou", "upload", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !client.Available() {
		t.Fatal("expected IMS SDK client to initialize when enabled with credentials")
	}
	if client.BizType != "upload" {
		t.Fatalf("expected bizType upload, got %q", client.BizType)
	}
}

func TestNewImageModerationClientDisabledSkipsSDK(t *testing.T) {
	client, err := NewImageModerationClient("test-id", "test-key", "ap-guangzhou", "upload", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.Available() {
		t.Fatal("disabled client should not be available")
	}
}

func TestIsImageModerationRejected(t *testing.T) {
	if IsImageModerationRejected(nil) {
		t.Fatal("nil should not be rejected")
	}
	if !IsImageModerationRejected(fmtBlockedErr()) {
		t.Fatal("expected blocked rejected")
	}
	if IsImageModerationReview(fmtBlockedErr()) {
		t.Fatal("blocked should not be review")
	}
	if !IsImageModerationReview(fmtReviewErr()) {
		t.Fatal("expected review")
	}
}

func fmtBlockedErr() error {
	return errors.Join(ErrImageModerationBlocked, errors.New("图片未通过内容安全审核（Porn）"))
}

func fmtReviewErr() error {
	return errors.Join(ErrImageModerationReview, errors.New("图片需人工复核"))
}
