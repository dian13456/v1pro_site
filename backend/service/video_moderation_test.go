package service

import (
	"testing"
	"time"
)

func TestNewVideoModerationClientInitializesSDK(t *testing.T) {
	client, err := NewVideoModerationClient(
		"test-id",
		"test-key",
		"ap-guangzhou",
		"video",
		true,
		defaultVMPollInterval,
		defaultVMPollTimeout,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !client.Available() {
		t.Fatal("expected VM SDK client to initialize when enabled with credentials")
	}
	if client.BizType != "video" {
		t.Fatalf("expected bizType video, got %q", client.BizType)
	}
}

func TestNewVideoModerationClientDisabledSkipsSDK(t *testing.T) {
	client, err := NewVideoModerationClient(
		"test-id",
		"test-key",
		"ap-guangzhou",
		"video",
		false,
		defaultVMPollInterval,
		defaultVMPollTimeout,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.Available() {
		t.Fatal("disabled client should not be available")
	}
}

func TestNormalizeModerationSuggestion(t *testing.T) {
	if got := normalizeModerationSuggestion("Pass"); got != "PASS" {
		t.Fatalf("expected PASS, got %q", got)
	}
	if got := normalizeModerationSuggestion("Review"); got != "REVIEW" {
		t.Fatalf("expected REVIEW, got %q", got)
	}
	if got := normalizeModerationSuggestion("Block"); got != "BLOCK" {
		t.Fatalf("expected BLOCK, got %q", got)
	}
}

func TestParseVideoModerationPollConfig(t *testing.T) {
	interval, timeout := ParseVideoModerationPollConfig("3", "120")
	if interval != 3*time.Second || timeout != 120*time.Second {
		t.Fatalf("unexpected poll config: interval=%s timeout=%s", interval, timeout)
	}
}
