package service

import (
	"testing"
	"time"
)

func TestAllowTokenAndIP_BothMustPass(t *testing.T) {
	tokenLimiter := NewIPRateLimiter(1, time.Minute)
	ipLimiter := NewIPRateLimiter(10, time.Minute)

	if !AllowTokenAndIP(tokenLimiter, ipLimiter, "dev-a", "1.1.1.1") {
		t.Fatal("first request should pass")
	}
	if AllowTokenAndIP(tokenLimiter, ipLimiter, "dev-a", "1.1.1.1") {
		t.Fatal("second token request should be blocked")
	}
	if !AllowTokenAndIP(tokenLimiter, ipLimiter, "dev-b", "1.1.1.1") {
		t.Fatal("different token should pass when IP limit not reached")
	}
}

func TestAllowTokenAndIP_EmptyTokenUsesIPOnly(t *testing.T) {
	tokenLimiter := NewIPRateLimiter(1, time.Minute)
	ipLimiter := NewIPRateLimiter(2, time.Minute)

	if !AllowTokenAndIP(tokenLimiter, ipLimiter, "", "2.2.2.2") {
		t.Fatal("first IP-only request should pass")
	}
	if !AllowTokenAndIP(tokenLimiter, ipLimiter, "", "2.2.2.2") {
		t.Fatal("second IP-only request should pass")
	}
	if AllowTokenAndIP(tokenLimiter, ipLimiter, "", "2.2.2.2") {
		t.Fatal("third IP-only request should be blocked")
	}
}
