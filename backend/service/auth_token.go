package service

import (
	"fmt"
	"crypto/sha256"
	"strconv"
	"strings"
	"time"
)

const DefaultTokenTTL = 30 * 24 * time.Hour

func SignTokenPayload(payload string, jwtSecret string) string {
	sum := sha256.Sum256([]byte(payload + "." + jwtSecret))
	return fmt.Sprintf("%x", sum[:])
}

func CreateToken(serial string, jwtSecret string) string {
	payload := fmt.Sprintf("%s.%d", serial, time.Now().UnixMilli())
	signature := SignTokenPayload(payload, jwtSecret)
	return payload + "." + signature
}

func SplitToken(token string) (payload string, signature string, ok bool) {
	token = strings.TrimSpace(token)
	lastDot := strings.LastIndex(token, ".")
	if lastDot <= 0 || lastDot >= len(token)-1 {
		return "", "", false
	}
	return token[:lastDot], token[lastDot+1:], true
}

func tokenIssuedAt(payload string) (time.Time, bool) {
	lastDot := strings.LastIndex(payload, ".")
	if lastDot <= 0 || lastDot >= len(payload)-1 {
		return time.Time{}, false
	}
	ms, err := strconv.ParseInt(payload[lastDot+1:], 10, 64)
	if err != nil || ms <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(ms), true
}

func VerifyToken(token string, jwtSecret string, ttl time.Duration) bool {
	payload, signature, ok := SplitToken(token)
	if !ok {
		return false
	}
	if SignTokenPayload(payload, jwtSecret) != signature {
		return false
	}
	if ttl <= 0 {
		return true
	}
	issuedAt, ok := tokenIssuedAt(payload)
	if !ok {
		return false
	}
	return time.Since(issuedAt) <= ttl
}

func SerialFromToken(token string, jwtSecret string, ttl time.Duration) (string, bool) {
	if !VerifyToken(token, jwtSecret, ttl) {
		return "", false
	}
	payload, _, ok := SplitToken(token)
	if !ok {
		return "", false
	}
	lastDot := strings.LastIndex(payload, ".")
	if lastDot <= 0 {
		return "", false
	}
	serial := strings.TrimSpace(payload[:lastDot])
	return serial, serial != ""
}

func ParseTokenTTLDays(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.EqualFold(raw, "0") {
		return DefaultTokenTTL
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days <= 0 {
		return DefaultTokenTTL
	}
	return time.Duration(days) * 24 * time.Hour
}
