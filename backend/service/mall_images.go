package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

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

func MallImageObjectKey(publicBase, rawURL string) (string, bool) {
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	text := strings.TrimSpace(rawURL)
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

func SignMallImageURLIfOwned(ctx context.Context, signer *COSSigner, publicBase, rawURL string, ttl time.Duration) (string, error) {
	text := strings.TrimSpace(rawURL)
	if text == "" {
		return "", nil
	}
	key, owned := MallImageObjectKey(publicBase, text)
	if !owned || signer == nil {
		return text, nil
	}
	return signer.GenerateReadURL(ctx, key, ttl)
}

func SignMallProductImages(ctx context.Context, signer *COSSigner, publicBase string, ttl time.Duration, p *MallProduct) {
	if p == nil {
		return
	}
	NormalizeMallProductImages(p)
	for i, item := range p.ImageURLs {
		if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, item, ttl); err == nil && signed != "" {
			p.ImageURLs[i] = signed
		}
	}
	if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, p.ImageURL, ttl); err == nil && signed != "" {
		p.ImageURL = signed
	}
}

func SignMallOrderItemImages(ctx context.Context, signer *COSSigner, publicBase string, ttl time.Duration, items []MallOrderItem) {
	for i := range items {
		if signed, err := SignMallImageURLIfOwned(ctx, signer, publicBase, items[i].ImageURL, ttl); err == nil && signed != "" {
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
