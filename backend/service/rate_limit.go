package service

import (
	"strings"
	"sync"
	"time"
)

type IPRateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func NewIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	if limit <= 0 {
		limit = 10
	}
	if window <= 0 {
		window = time.Minute
	}
	return &IPRateLimiter{
		limit:  limit,
		window: window,
		hits:   map[string][]time.Time{},
	}
}

func (limiter *IPRateLimiter) Allow(key string) bool {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "unknown"
	}
	now := time.Now()
	cutoff := now.Add(-limiter.window)

	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	times := limiter.hits[key]
	filtered := times[:0]
	for _, ts := range times {
		if ts.After(cutoff) {
			filtered = append(filtered, ts)
		}
	}
	if len(filtered) >= limiter.limit {
		limiter.hits[key] = filtered
		return false
	}
	filtered = append(filtered, now)
	limiter.hits[key] = filtered
	return true
}

// AllowTokenAndIP returns false when either limiter rejects its key.
// Empty tokenKey skips the token limiter (IP-only).
func AllowTokenAndIP(tokenLimiter, ipLimiter *IPRateLimiter, tokenKey, ipKey string) bool {
	if ipLimiter != nil && !ipLimiter.Allow(ipKey) {
		return false
	}
	tokenKey = strings.TrimSpace(tokenKey)
	if tokenKey != "" && tokenLimiter != nil && !tokenLimiter.Allow(tokenKey) {
		return false
	}
	return true
}
