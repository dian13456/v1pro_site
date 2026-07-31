package service

import (
	"encoding/json"
	"strings"
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
