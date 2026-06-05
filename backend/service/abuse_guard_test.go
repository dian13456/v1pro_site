package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAbuseGuardBlocksAfterNotFoundBurst(t *testing.T) {
	guard := NewAbuseGuard(AbuseGuardConfig{
		ReadIPPerMin:           100,
		DownloadTokenPerMin:    100,
		DownloadIPPerMin:       100,
		InvalidTokenIPPerMin:   100,
		NotFoundIPPerMin:       2,
		GlobalIPPerMin:         1000,
		NotFoundBlockThreshold: 2,
		InvalidBlockThreshold:  100,
		BlockDuration:          time.Minute,
	})

	ip := "10.0.0.9"
	for i := 0; i < 3; i++ {
		guard.RecordNotFound(ip)
	}
	if !guard.IsBlocked(ip) {
		t.Fatalf("expected ip to be blocked after repeated not-found scans")
	}
}

func TestAbuseGuardRejectRead(t *testing.T) {
	gin.SetMode(gin.TestMode)
	guard := NewAbuseGuard(AbuseGuardConfig{
		ReadIPPerMin:           1,
		DownloadTokenPerMin:    10,
		DownloadIPPerMin:       10,
		InvalidTokenIPPerMin:   10,
		NotFoundIPPerMin:       10,
		GlobalIPPerMin:         100,
		BlockDuration:          time.Minute,
	})

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/resources", nil)

	if guard.RejectRead(ctx, "1.2.3.4") {
		t.Fatalf("first read should pass")
	}
	if !guard.RejectRead(ctx, "1.2.3.4") {
		t.Fatalf("second read should be rejected")
	}
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
}

func TestAbuseGuardDownloadSign(t *testing.T) {
	gin.SetMode(gin.TestMode)
	guard := NewAbuseGuard(AbuseGuardConfig{
		ReadIPPerMin:         100,
		DownloadTokenPerMin:  1,
		DownloadIPPerMin:     100,
		InvalidTokenIPPerMin: 100,
		NotFoundIPPerMin:     100,
		GlobalIPPerMin:       1000,
		BlockDuration:        time.Minute,
	})

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/resource/1", nil)

	if guard.RejectDownloadSign(ctx, "1.2.3.4", "serial-a") {
		t.Fatalf("first download sign should pass")
	}
	if !guard.RejectDownloadSign(ctx, "1.2.3.4", "serial-a") {
		t.Fatalf("second download sign for same serial should be rejected")
	}
}
