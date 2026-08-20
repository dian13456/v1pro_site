package service

import "testing"

func TestValidatePromoHTTPURL(t *testing.T) {
	valid := []string{
		"https://example.com/video/123",
		"http://example.com/image.png?x=1",
	}
	for _, value := range valid {
		if !validatePromoHTTPURL(value) {
			t.Fatalf("expected valid URL: %s", value)
		}
	}

	invalid := []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"/relative/path",
		"https://user:password@example.com/image.png",
	}
	for _, value := range invalid {
		if validatePromoHTTPURL(value) {
			t.Fatalf("expected invalid URL: %s", value)
		}
	}
}
