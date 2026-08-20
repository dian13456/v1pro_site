package main

import (
	"net/http"
	"strings"
)

func imagePayloadMatchesContentType(data []byte, expected string) bool {
	if len(data) == 0 {
		return false
	}
	detected := strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	expected = strings.ToLower(strings.TrimSpace(expected))
	return detected == expected
}
