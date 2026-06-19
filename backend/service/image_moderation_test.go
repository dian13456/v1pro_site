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
	client, err := NewImageModerationClient("test-id", "test-key", "ap-guangzhou", "upload", true, DefaultGifModerationConfig())
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
	client, err := NewImageModerationClient("test-id", "test-key", "ap-guangzhou", "upload", false, DefaultGifModerationConfig())
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

func TestStrictestModerationOutcome(t *testing.T) {
	pass := ImageModerationOutcome{Suggestion: "PASS"}
	review := ImageModerationOutcome{Suggestion: "REVIEW", Label: "Sexy"}
	block := ImageModerationOutcome{Suggestion: "BLOCK", Label: "Porn"}

	if got := strictestModerationOutcome(pass, pass); got.Suggestion != "PASS" {
		t.Fatalf("expected PASS, got %q", got.Suggestion)
	}
	if got := strictestModerationOutcome(pass, review); got.Suggestion != "REVIEW" {
		t.Fatalf("expected REVIEW, got %q", got.Suggestion)
	}
	if got := strictestModerationOutcome(review, block); got.Suggestion != "BLOCK" {
		t.Fatalf("expected BLOCK, got %q", got.Suggestion)
	}
}

func TestParseGifModerationConfig(t *testing.T) {
	cfg := ParseGifModerationConfig("3", "8")
	if cfg.Interval != 3 || cfg.MaxFrames != 8 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	cfg = ParseGifModerationConfig("", "")
	if cfg.Interval != defaultGifInterval || cfg.MaxFrames != defaultGifMaxFrames {
		t.Fatalf("expected defaults, got %+v", cfg)
	}
}
