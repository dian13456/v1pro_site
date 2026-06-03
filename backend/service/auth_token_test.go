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
			"id":       1,
			"title":    "demo",
			"image":    "https://bucket.cos.ap-guangzhou.myqcloud.com/foo.jpg",
			"download": "https://bucket.cos.ap-guangzhou.myqcloud.com/foo.jpg",
		},
	}
	out := SanitizePublicResourceCatalog(items)
	if _, ok := out[0]["download"]; ok {
		t.Fatalf("download url should be removed")
	}
	if out[0]["image"] != "foo.jpg" {
		t.Fatalf("expected object key foo.jpg, got %#v", out[0]["image"])
	}
}
