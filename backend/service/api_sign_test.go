package service

import (
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSignAPIRequestWithAndWithoutToken(t *testing.T) {
	secret := "sign-secret"
	bodyHash := sha256Hex([]byte(`{"serial":"abc"}`))
	canonicalPath := "/api/auth"

	baseSig := SignAPIRequest(secret, "", "POST", canonicalPath, "1700000000", "nonce-1", bodyHash)
	if baseSig == "" {
		t.Fatal("expected base signature")
	}

	token := CreateToken("048366AA1234", "jwt-secret")
	tokenSig := SignAPIRequest(secret, token, "GET", "/api/profile", "1700000000", "nonce-2", sha256Hex(nil))
	if tokenSig == "" || tokenSig == baseSig {
		t.Fatalf("expected token-bound signature, got %q base %q", tokenSig, baseSig)
	}

	replay := SignAPIRequest(secret, "", "POST", canonicalPath, "1700000000", "nonce-1", bodyHash)
	if replay != baseSig {
		t.Fatalf("expected deterministic signature")
	}
}

func TestAPISignMiddlewareRejectsMissingSignature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	verifier := NewAPISignVerifier("sign-secret", time.Minute, true)
	r := gin.New()
	r.Use(verifier.Middleware())
	r.GET("/api/resources", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/api/resources", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAPISignMiddlewareAcceptsValidSignature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "sign-secret"
	verifier := NewAPISignVerifier(secret, time.Minute, true)
	r := gin.New()
	r.Use(verifier.Middleware())
	r.POST("/api/auth", func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true})
	})

	body := `{"serial":"abc","vid":"0483","pid":"66AA"}`
	unixTS := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "unit-test-nonce-accept"
	sig := SignAPIRequestForTest(secret, "", "POST", "/api/auth", unixTS, nonce, body)

	req := httptest.NewRequest("POST", "/api/auth", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(HeaderAPITimestamp, unixTS)
	req.Header.Set(HeaderAPINonce, nonce)
	req.Header.Set(HeaderAPISignature, sig)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAPISignMiddlewareSkipsDownloadQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	verifier := NewAPISignVerifier("sign-secret", time.Minute, true)
	r := gin.New()
	r.Use(verifier.Middleware())
	r.GET("/api/image/", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	req := httptest.NewRequest("GET", "/api/image/?id=1&download=1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200 without api sign for download=1, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAPISignMiddlewareSkipsAdminRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	verifier := NewAPISignVerifier("sign-secret", time.Minute, true)
	r := gin.New()
	r.Use(verifier.Middleware())
	r.GET("/api/admin/image-reviews", func(c *gin.Context) {
		c.Status(204)
	})

	req := httptest.NewRequest("GET", "/api/admin/image-reviews", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("expected admin route without signature, got %d", rec.Code)
	}
}
