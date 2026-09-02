package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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

func TestRuntimeResourceMapRemoveInvalidatesCachedEntryImmediately(t *testing.T) {
	path := filepath.Join(t.TempDir(), "map.json")
	if err := os.WriteFile(path, []byte(`{"9":"old.jpg"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &runtimeResourceMap{
		path: path, data: resourceMap{"9": "old.jpg"}, lastModTime: time.Now(),
	}
	store.remove("9")
	if _, ok := store.get("9"); ok {
		t.Fatal("deleted runtime resource remained accessible")
	}
}
