package service

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AbuseGuard limits abnormal read/download patterns and temporarily blocks abusive IPs.
type AbuseGuard struct {
	readIP           *IPRateLimiter
	downloadToken    *IPRateLimiter
	downloadIP       *IPRateLimiter
	invalidTokenIP   *IPRateLimiter
	notFoundIP       *IPRateLimiter
	globalIP         *IPRateLimiter
	blockDuration    time.Duration
	notFoundBlockAt  int
	invalidBlockAt   int

	mu           sync.Mutex
	blockedUntil map[string]time.Time
}

type AbuseGuardConfig struct {
	ReadIPPerMin           int
	DownloadTokenPerMin    int
	DownloadIPPerMin       int
	InvalidTokenIPPerMin   int
	NotFoundIPPerMin       int
	GlobalIPPerMin         int
	NotFoundBlockThreshold int
	InvalidBlockThreshold  int
	BlockDuration          time.Duration
}

func parseEnvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parseEnvDurationMin(key string, fallback time.Duration) time.Duration {
	minutes := parseEnvInt(key, int(fallback/time.Minute))
	if minutes <= 0 {
		minutes = 1
	}
	return time.Duration(minutes) * time.Minute
}

func AbuseGuardConfigFromEnv() AbuseGuardConfig {
	return AbuseGuardConfig{
		ReadIPPerMin:           parseEnvInt("READ_RATE_LIMIT_IP_PER_MIN", 90),
		DownloadTokenPerMin:    parseEnvInt("DOWNLOAD_SIGN_RATE_LIMIT_TOKEN_PER_MIN", 40),
		DownloadIPPerMin:       parseEnvInt("DOWNLOAD_SIGN_RATE_LIMIT_IP_PER_MIN", 80),
		InvalidTokenIPPerMin:   parseEnvInt("INVALID_TOKEN_RATE_LIMIT_IP_PER_MIN", 45),
		NotFoundIPPerMin:       parseEnvInt("NOT_FOUND_SCAN_LIMIT_IP_PER_MIN", 25),
		GlobalIPPerMin:         parseEnvInt("GLOBAL_API_RATE_LIMIT_IP_PER_MIN", 240),
		NotFoundBlockThreshold: parseEnvInt("NOT_FOUND_BLOCK_THRESHOLD", 20),
		InvalidBlockThreshold:  parseEnvInt("INVALID_TOKEN_BLOCK_THRESHOLD", 35),
		BlockDuration:          parseEnvDurationMin("ABUSE_BLOCK_DURATION_MIN", 15*time.Minute),
	}
}

func NewAbuseGuard(cfg AbuseGuardConfig) *AbuseGuard {
	if cfg.BlockDuration <= 0 {
		cfg.BlockDuration = 15 * time.Minute
	}
	if cfg.NotFoundBlockThreshold <= 0 {
		cfg.NotFoundBlockThreshold = 20
	}
	if cfg.InvalidBlockThreshold <= 0 {
		cfg.InvalidBlockThreshold = 35
	}
	return &AbuseGuard{
		readIP:           NewIPRateLimiter(cfg.ReadIPPerMin, time.Minute),
		downloadToken:    NewIPRateLimiter(cfg.DownloadTokenPerMin, time.Minute),
		downloadIP:       NewIPRateLimiter(cfg.DownloadIPPerMin, time.Minute),
		invalidTokenIP:   NewIPRateLimiter(cfg.InvalidTokenIPPerMin, time.Minute),
		notFoundIP:       NewIPRateLimiter(cfg.NotFoundIPPerMin, time.Minute),
		globalIP:         NewIPRateLimiter(cfg.GlobalIPPerMin, time.Minute),
		blockDuration:    cfg.BlockDuration,
		notFoundBlockAt:  cfg.NotFoundBlockThreshold,
		invalidBlockAt:   cfg.InvalidBlockThreshold,
		blockedUntil:     map[string]time.Time{},
	}
}

func normalizeGuardKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return "unknown"
	}
	return key
}

func (guard *AbuseGuard) cleanupBlocked(now time.Time) {
	for ip, until := range guard.blockedUntil {
		if !until.After(now) {
			delete(guard.blockedUntil, ip)
		}
	}
}

func (guard *AbuseGuard) IsBlocked(ip string) bool {
	ip = normalizeGuardKey(ip)
	now := time.Now()

	guard.mu.Lock()
	defer guard.mu.Unlock()
	guard.cleanupBlocked(now)

	until, ok := guard.blockedUntil[ip]
	return ok && until.After(now)
}

func (guard *AbuseGuard) blockIP(ip string) {
	ip = normalizeGuardKey(ip)
	until := time.Now().Add(guard.blockDuration)

	guard.mu.Lock()
	defer guard.mu.Unlock()
	guard.blockedUntil[ip] = until
}

func (guard *AbuseGuard) rejectBlocked(c *gin.Context, ip string) bool {
	if guard == nil || !guard.IsBlocked(ip) {
		return false
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": "请求过于频繁，请稍后再试",
	})
	return true
}

// Middleware rejects temporarily blocked IPs before handlers run.
func (guard *AbuseGuard) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if guard == nil {
			c.Next()
			return
		}
		ip := ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP"))
		if guard.rejectBlocked(c, ip) {
			c.Abort()
			return
		}
		if !guard.globalIP.Allow(ip) {
			guard.blockIP(ip)
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"message": "请求过于频繁，请稍后再试",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (guard *AbuseGuard) RejectRead(c *gin.Context, ip string) bool {
	if guard == nil {
		return false
	}
	if guard.rejectBlocked(c, ip) {
		return true
	}
	if guard.readIP.Allow(ip) {
		return false
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": "读取过于频繁，请稍后再试",
	})
	return true
}

func (guard *AbuseGuard) RejectDownloadSign(c *gin.Context, ip, serial string) bool {
	if guard == nil {
		return false
	}
	if guard.rejectBlocked(c, ip) {
		return true
	}
	if AllowTokenAndIP(guard.downloadToken, guard.downloadIP, serial, ip) {
		return false
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"error":   "下载请求过于频繁，请稍后再试",
	})
	return true
}

func (guard *AbuseGuard) RecordNotFound(ip string) {
	if guard == nil {
		return
	}
	ip = normalizeGuardKey(ip)
	if !guard.notFoundIP.Allow(ip) {
		guard.blockIP(ip)
	}
}

func (guard *AbuseGuard) RecordInvalidToken(ip string) {
	if guard == nil {
		return
	}
	ip = normalizeGuardKey(ip)
	if guard.invalidTokenIP.Allow(ip) {
		return
	}
	guard.blockIP(ip)
}
