package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

func isLegacyManagedImageHost(host string) bool {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == "" {
		return false
	}
	if h == "media.jadot.cn" || h == "media.jadot.club" {
		return true
	}
	// Older promo records retain URLs from the former per-type image bucket.
	// The object key is still valid after migration to the unified bucket.
	return strings.HasPrefix(h, "v1image-") && strings.Contains(h, ".cos.")
}

func stripProtocolAndQuery(raw string) string {
	text := strings.TrimSpace(raw)
	if idx := strings.Index(text, "?"); idx >= 0 {
		text = text[:idx]
	}
	if idx := strings.Index(text, "#"); idx >= 0 {
		text = text[:idx]
	}
	return text
}

func NormalizeMallProductImages(p *MallProduct) {
	if p == nil {
		return
	}
	urls := make([]string, 0, len(p.ImageURLs)+1)
	seen := map[string]struct{}{}
	appendURL := func(raw string) {
		text := strings.TrimSpace(raw)
		if text == "" {
			return
		}
		if _, ok := seen[text]; ok {
			return
		}
		seen[text] = struct{}{}
		urls = append(urls, text)
	}
	for _, item := range p.ImageURLs {
		appendURL(item)
	}
	appendURL(p.ImageURL)
	p.ImageURLs = urls
	if len(urls) > 0 {
		p.ImageURL = urls[0]
	} else {
		p.ImageURL = ""
	}
}

func EncodeMallImageURLs(urls []string) string {
	normalized := make([]string, 0, len(urls))
	seen := map[string]struct{}{}
	for _, item := range urls {
		text := strings.TrimSpace(item)
		if text == "" {
			continue
		}
		if _, ok := seen[text]; ok {
			continue
		}
		seen[text] = struct{}{}
		normalized = append(normalized, text)
	}
	if len(normalized) == 0 {
		return "[]"
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func StripURLQuery(raw string) string {
	text := strings.TrimSpace(raw)
	if idx := strings.Index(text, "?"); idx >= 0 {
		return text[:idx]
	}
	if idx := strings.Index(text, "#"); idx >= 0 {
		return text[:idx]
	}
	return text
}

func MallImageObjectKey(publicBase, rawURL string) (string, bool) {
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	text := stripProtocolAndQuery(rawURL)
	if base == "" || text == "" {
		return "", false
	}
	prefix := base + "/"
	if !strings.HasPrefix(text, prefix) {
		return "", false
	}
	key := strings.TrimPrefix(text, prefix)
	return key, key != ""
}

func MallImageObjectKeyWithBucket(publicBase, bucket, rawURL string) (string, bool) {
	candidates := mallImageObjectKeyCandidates(publicBase, bucket, rawURL)
	if len(candidates) == 0 {
		return "", false
	}
	return candidates[0], true
}

func mallImageObjectKeyCandidates(publicBase, bucket, rawURL string) []string {
	candidates := []string{}
	seen := map[string]struct{}{}
	addCandidate := func(key string) {
		key = strings.Trim(strings.TrimSpace(key), "/")
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		candidates = append(candidates, key)
	}

	if key, ok := MallImageObjectKey(publicBase, rawURL); ok {
		addCandidate(key)
	}

	text := strings.TrimSpace(rawURL)
	if text == "" {
		return candidates
	}
	if !strings.Contains(text, "://") {
		return candidates
	}
	parsed, err := url.Parse(text)
	if err != nil || parsed == nil || parsed.Path == "" {
		return candidates
	}

	pathText := strings.TrimPrefix(stripProtocolAndQuery(parsed.Path), "/")
	if pathText == "" {
		return candidates
	}

	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if strings.HasPrefix(pathText, "activity/promo/") || strings.HasPrefix(pathText, "mall/products/") {
		if isLegacyManagedImageHost(host) {
			addCandidate(pathText)
		}
	}

	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		return candidates
	}
	marker := "://" + bucket + ".cos."
	pos := strings.Index(text, marker)
	if pos < 0 {
		return candidates
	}
	rest := text[pos+len(marker):]
	slash := strings.Index(rest, "/")
	if slash < 0 {
		return candidates
	}
	addCandidate(rest[slash+1:])
	return candidates
}

func mallImageLoadCandidates(signer *COSSigner, key string) []string {
	trimmed := strings.TrimLeft(strings.TrimSpace(key), "/")
	if trimmed == "" {
		return []string{}
	}
	prefixes := []string{trimmed}
	prefix := ""
	if signer != nil {
		prefix = strings.Trim(strings.TrimSpace(signer.objectPrefix), "/")
		if prefix != "" {
			if strings.HasPrefix(trimmed, prefix+"/") {
				prefixes = append(prefixes, strings.TrimPrefix(trimmed, prefix+"/"))
			} else {
				prefixes = append(prefixes, prefix+"/"+trimmed)
			}
		}
	}

	seen := map[string]struct{}{}
	candidates := []string{}
	for _, value := range prefixes {
		value = strings.TrimLeft(strings.TrimSpace(value), "/")
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}
	return candidates
}

func MallImageContentType(objectKey string) string {
	switch strings.ToLower(filepath.Ext(objectKey)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func SignMallImageURLIfOwned(ctx context.Context, signer *COSSigner, publicBase, bucket, rawURL string, ttl time.Duration) (string, error) {
	text := strings.TrimSpace(rawURL)
	if text == "" {
		return "", nil
	}
	if strings.Contains(text, "q-sign-algorithm=") || strings.Contains(text, "x-cos-security-token=") {
		return text, nil
	}
	key, owned := MallImageObjectKeyWithBucket(publicBase, bucket, text)
	if !owned || signer == nil {
		return text, nil
	}
	return signer.GenerateReadURL(ctx, key, ttl)
}

func SignMallProductImages(ctx context.Context, signer *COSSigner, publicBase, bucket string, ttl time.Duration, p *MallProduct) {
	if p == nil {
		return
	}
	NormalizeMallProductImages(p)
	for i, item := range p.ImageURLs {
		if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, bucket, item, ttl); err == nil && signed != "" {
			p.ImageURLs[i] = signed
		}
	}
	if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, bucket, p.ImageURL, ttl); err == nil && signed != "" {
		p.ImageURL = signed
	}
}

func LoadMallImageObject(ctx context.Context, signer *COSSigner, publicBase, bucket, rawURL string) ([]byte, string, error) {
	key, ok := MallImageObjectKeyWithBucket(publicBase, bucket, rawURL)
	if !ok || signer == nil {
		return nil, "", fmt.Errorf("图片地址无效")
	}

	candidates := mallImageLoadCandidates(signer, key)
	var lastErr error
	for _, candidate := range candidates {
		data, err := signer.GetObject(ctx, candidate)
		if err == nil {
			return data, MallImageContentType(candidate), nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, "", lastErr
	}
	return nil, "", fmt.Errorf("读取图片失败")
}

func SignMallOrderItemImages(ctx context.Context, signer *COSSigner, publicBase, bucket string, ttl time.Duration, items []MallOrderItem) {
	for i := range items {
		if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, bucket, items[i].ImageURL, ttl); err == nil && signed != "" {
			items[i].ImageURL = signed
		}
	}
}

func DecodeMallImageURLs(raw string, legacyURL string) []string {
	text := strings.TrimSpace(raw)
	if text != "" {
		var urls []string
		if err := json.Unmarshal([]byte(text), &urls); err == nil {
			product := MallProduct{ImageURLs: urls, ImageURL: legacyURL}
			NormalizeMallProductImages(&product)
			return product.ImageURLs
		}
	}
	product := MallProduct{ImageURL: legacyURL}
	NormalizeMallProductImages(&product)
	return product.ImageURLs
}
