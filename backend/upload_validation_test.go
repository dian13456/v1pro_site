package main

import "testing"

func TestImagePayloadMatchesContentType(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52}
	if !imagePayloadMatchesContentType(png, "image/png") {
		t.Fatal("expected PNG payload to match")
	}
	if imagePayloadMatchesContentType([]byte("<script>alert(1)</script>"), "image/png") {
		t.Fatal("expected non-image payload to be rejected")
	}
	if imagePayloadMatchesContentType(png, "image/jpeg") {
		t.Fatal("expected mismatched image type to be rejected")
	}
}
