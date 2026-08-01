package service

import (
	"context"
	"testing"
)

func TestMallImageObjectKey(t *testing.T) {
	base := "https://example.cos.ap-guangzhou.myqcloud.com"
	key, ok := MallImageObjectKey(base, base+"/mall/products/abc.jpg")
	if !ok || key != "mall/products/abc.jpg" {
		t.Fatalf("expected owned object key, got %q ok=%v", key, ok)
	}
	_, ok = MallImageObjectKey(base, "https://other.example.com/a.jpg")
	if ok {
		t.Fatal("expected external url to be rejected")
	}
}

func TestSignMallImageURLIfOwnedExternalPassthrough(t *testing.T) {
	got, err := SignMallImageURLIfOwned(context.Background(), nil, "https://bucket.cos.region.myqcloud.com", "https://cdn.example.com/a.jpg", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://cdn.example.com/a.jpg" {
		t.Fatalf("expected passthrough, got %q", got)
	}
}
