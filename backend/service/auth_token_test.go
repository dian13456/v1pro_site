package service

import (
	"strings"
	"testing"
	"time"
)

func TestVerifyTokenExpires(t *testing.T) {
	secret := "test-secret"
	serial := "048366AA1234"
	payload := serial + "." + strings.TrimSpace("1700000000000")
	token := payload + "." + SignTokenPayload(payload, secret)

	if VerifyToken(token, secret, 0) != true {
		t.Fatalf("expected token to verify when ttl disabled")
	}
	if VerifyToken(token, secret, time.Hour) != false {
		t.Fatalf("expected old token to expire")
	}

	fresh := CreateToken(serial, secret)
	parsedSerial, ok := SerialFromToken(fresh, secret, 24*time.Hour)
	if !ok || parsedSerial != serial {
		t.Fatalf("expected fresh token serial %q, got %q ok=%v", serial, parsedSerial, ok)
	}
}

func TestIPRateLimiter(t *testing.T) {
	limiter := NewIPRateLimiter(2, time.Minute)
	if !limiter.Allow("1.2.3.4") || !limiter.Allow("1.2.3.4") {
		t.Fatalf("expected first two requests to pass")
	}
	if limiter.Allow("1.2.3.4") {
		t.Fatalf("expected third request to be blocked")
	}
	if !limiter.Allow("5.6.7.8") {
		t.Fatalf("expected different ip to pass")
	}
}

func TestSanitizePublicResourceCatalog(t *testing.T) {
	items := []map[string]any{
		{
			"id":             1,
			"title":          "demo",
			"image":          "https://bucket.cos.ap-guangzhou.myqcloud.com/foo.jpg",
			"download":       "https://bucket.cos.ap-guangzhou.myqcloud.com/foo.jpg",
			"uploaderSerial": "SN-001",
		},
		{
			"id":              2,
			"title":           "legacy",
			"image":           "legacy.jpg",
			"_uploaderSerial": "SN-LEGACY",
		},
	}
	out := SanitizePublicResourceCatalog(items)
	if _, ok := out[0]["download"]; ok {
		t.Fatalf("download url should be removed")
	}
	if out[0]["image"] != "foo.jpg" {
		t.Fatalf("expected object key foo.jpg, got %#v", out[0]["image"])
	}
	if out[0]["uploaderBlockable"] != true {
		t.Fatalf("expected uploader to be blockable")
	}
	if _, ok := out[0]["uploaderSerial"]; ok {
		t.Fatalf("uploader serial should remain private")
	}
	if out[1]["uploaderBlockable"] != true {
		t.Fatalf("expected legacy uploader to be blockable")
	}
	if _, ok := out[1]["_uploaderSerial"]; ok {
		t.Fatalf("legacy uploader serial should remain private")
	}
}

func TestSelectPublicResourceCatalogPreservesRecommendationOrder(t *testing.T) {
	items := []map[string]any{
		{"id": float64(1), "title": "one", "image": "https://example.com/one.png", "download": "secret-one"},
		{"id": float64(2), "title": "two", "image": "two.png", "uploaderSerial": "SN-2"},
	}
	selected := SelectPublicResourceCatalog(items, []string{"2", "1", "missing"})
	if len(selected) != 2 {
		t.Fatalf("len(selected) = %d, want 2", len(selected))
	}
	if recommendationString(selected[0]["id"]) != "2" || recommendationString(selected[1]["id"]) != "1" {
		t.Fatalf("unexpected order: %#v", selected)
	}
	for _, item := range selected {
		if _, ok := item["download"]; ok {
			t.Fatal("download must be removed")
		}
		if _, ok := item["uploaderSerial"]; ok {
			t.Fatal("uploaderSerial must be removed")
		}
		if _, ok := item["_uploaderSerial"]; ok {
			t.Fatal("_uploaderSerial must be removed")
		}
	}
}
