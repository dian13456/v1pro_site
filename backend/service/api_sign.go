package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	HeaderAPITimestamp = "X-Api-Timestamp"
	HeaderAPINonce     = "X-Api-Nonce"
	HeaderAPISignature = "X-Api-Signature"
	apiSignClientSalt  = "jiadian-api-sign-v1"
)

// APISignVerifier validates HMAC request signatures on /api routes.
type APISignVerifier struct {
	secret   []byte
	maxSkew  time.Duration
	required bool
	nonces   *apiNonceCache
}

func parseAPISignRequired(raw string, secretConfigured bool) bool {
	raw = strings.TrimSpace(strings.ToLower(raw))
	switch raw {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	default:
		return secretConfigured
	}
}

func parseAPISignMaxSkew(raw string) time.Duration {
	seconds, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || seconds <= 0 {
		seconds = 300
	}
	return time.Duration(seconds) * time.Second
}

// APISignConfigFromEnv loads signing settings from the environment.
func APISignConfigFromEnv() (secret string, maxSkew time.Duration, required bool) {
	secret = strings.TrimSpace(os.Getenv("API_SIGN_SECRET"))
	maxSkew = parseAPISignMaxSkew(os.Getenv("API_SIGN_MAX_SKEW_SEC"))
	required = parseAPISignRequired(os.Getenv("API_SIGN_REQUIRED"), secret != "")
	return secret, maxSkew, required
}

// NewAPISignVerifier creates a verifier. Empty secret disables enforcement unless required=true.
func NewAPISignVerifier(secret string, maxSkew time.Duration, required bool) *APISignVerifier {
	if maxSkew <= 0 {
		maxSkew = 5 * time.Minute
	}
	return &APISignVerifier{
		secret:   []byte(secret),
		maxSkew:  maxSkew,
		required: required,
		nonces:   newAPINonceCache(maxSkew * 2),
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256Hex(key []byte, message string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

func hmacSHA256(key []byte, message string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(message))
	return mac.Sum(nil)
}

func deriveAPISignKey(secret []byte, bearerToken string) []byte {
	token := strings.TrimSpace(bearerToken)
	if token == "" {
		return hmacSHA256(secret, apiSignClientSalt)
	}
	return hmacSHA256(secret, token)
}

// BuildAPICanonicalString builds the canonical payload used for signing.
func BuildAPICanonicalString(method, pathWithQuery, timestamp, nonce, bodyHash string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + "\n" +
		pathWithQuery + "\n" +
		timestamp + "\n" +
		nonce + "\n" +
		bodyHash
}

// SignAPIRequest returns the hex HMAC signature for a request.
func SignAPIRequest(secret, bearerToken, method, pathWithQuery, timestamp, nonce, bodyHash string) string {
	if strings.TrimSpace(secret) == "" {
		return ""
	}
	key := deriveAPISignKey([]byte(secret), bearerToken)
	return hmacSHA256Hex(key, BuildAPICanonicalString(method, pathWithQuery, timestamp, nonce, bodyHash))
}

func requestPathWithQuery(c *gin.Context) string {
	path := c.Request.URL.Path
	if raw := c.Request.URL.RawQuery; raw != "" {
		path += "?" + raw
	}
	return path
}

func parseBearerForSign(c *gin.Context) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
}

func (v *APISignVerifier) shouldVerify(path string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if strings.HasPrefix(path, "/api/admin/") {
		return false
	}
	if path == "/api/user-gif/upload" {
		return false
	}
	return true
}

func (v *APISignVerifier) enabled() bool {
	return len(v.secret) > 0
}

// Middleware rejects unsigned or tampered API requests when signing is enabled.
func (v *APISignVerifier) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !v.enabled() {
			if v.required {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"success": false,
					"message": "API 签名校验未配置",
				})
			}
			c.Next()
			return
		}

		path := c.Request.URL.Path
		if !v.shouldVerify(path) {
			c.Next()
			return
		}

		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取请求体"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		timestamp := strings.TrimSpace(c.GetHeader(HeaderAPITimestamp))
		nonce := strings.TrimSpace(c.GetHeader(HeaderAPINonce))
		signature := strings.ToLower(strings.TrimSpace(c.GetHeader(HeaderAPISignature)))
		if timestamp == "" || nonce == "" || signature == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "缺少 API 签名"})
			return
		}

		ts, err := strconv.ParseInt(timestamp, 10, 64)
		if err != nil || ts <= 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "API 签名时间戳无效"})
			return
		}
		now := time.Now().Unix()
		if delta := now - ts; delta > int64(v.maxSkew.Seconds()) || delta < -int64(v.maxSkew.Seconds()) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "API 签名已过期"})
			return
		}

		if len(nonce) < 8 || len(nonce) > 128 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "API nonce 无效"})
			return
		}
		if !v.nonces.Use(nonce, time.Unix(ts, 0)) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "API 签名重复提交"})
			return
		}

		bodyHash := sha256Hex(bodyBytes)
		expected := SignAPIRequest(
			string(v.secret),
			parseBearerForSign(c),
			c.Request.Method,
			requestPathWithQuery(c),
			timestamp,
			nonce,
			bodyHash,
		)
		if !hmac.Equal([]byte(expected), []byte(signature)) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "API 签名无效"})
			return
		}

		c.Next()
	}
}

type apiNonceEntry struct {
	expiresAt time.Time
}

type apiNonceCache struct {
	ttl  time.Duration
	mu   sync.Mutex
	data map[string]apiNonceEntry
}

func newAPINonceCache(ttl time.Duration) *apiNonceCache {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	cache := &apiNonceCache{
		ttl:  ttl,
		data: map[string]apiNonceEntry{},
	}
	go cache.cleanupLoop()
	return cache
}

func (c *apiNonceCache) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		c.cleanup()
	}
}

func (c *apiNonceCache) cleanup() {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.data {
		if now.After(entry.expiresAt) {
			delete(c.data, key)
		}
	}
}

func (c *apiNonceCache) Use(nonce string, issuedAt time.Time) bool {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.data[nonce]; ok && now.Before(entry.expiresAt) {
		return false
	}
	c.data[nonce] = apiNonceEntry{expiresAt: now.Add(c.ttl)}
	_ = issuedAt
	return true
}

// SignAPIRequestForTest exposes signing for tests in this package.
func SignAPIRequestForTest(secret, bearerToken, method, pathWithQuery, timestamp, nonce, body string) string {
	return SignAPIRequest(secret, bearerToken, method, pathWithQuery, timestamp, nonce, sha256Hex([]byte(body)))
}
