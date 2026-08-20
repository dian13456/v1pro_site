package service

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestCOSSignerPrefixIsAppliedToPresignedURL(t *testing.T) {
	signer, err := NewCOSSignerWithPrefix(
		"example-1250000000",
		"ap-guangzhou",
		"secret-id",
		"secret-key",
		"video/",
	)
	if err != nil {
		t.Fatal(err)
	}

	readURL, err := signer.GenerateReadURL(context.Background(), "/demo.mp4", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(readURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/video/demo.mp4" {
		t.Fatalf("unexpected object path: %s", parsed.Path)
	}

	putURL, err := signer.GeneratePutURL(context.Background(), "demo.mp4", "video/mp4", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsedPut, err := url.Parse(putURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsedPut.Path != "/video/demo.mp4" {
		t.Fatalf("unexpected upload object path: %s", parsedPut.Path)
	}
}

func TestCOSSignerGeneratesTencentTypeAURL(t *testing.T) {
	const authKey = "test-cdn-auth-key"
	signer, err := NewCOSSignerWithPrefix(
		"example-1250000000",
		"ap-guangzhou",
		"secret-id",
		"secret-key",
		"video",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := signer.ConfigureReadCDN("https://media.example.com", authKey, "sign"); err != nil {
		t.Fatal(err)
	}

	readURL, err := signer.GenerateReadURL(context.Background(), "目录/a b.mp4", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(readURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "media.example.com" || parsed.Path != "/video/目录/a b.mp4" {
		t.Fatalf("unexpected CDN URL: %s", readURL)
	}

	parts := strings.Split(parsed.Query().Get("sign"), "-")
	if len(parts) != 4 || parts[2] != "0" {
		t.Fatalf("unexpected Type-A signature: %q", parsed.Query().Get("sign"))
	}
	digest := md5.Sum([]byte(strings.Join([]string{
		parsed.EscapedPath(),
		parts[0],
		parts[1],
		parts[2],
		authKey,
	}, "-")))
	if parts[3] != hex.EncodeToString(digest[:]) {
		t.Fatalf("signature does not match escaped path: %s", parsed.EscapedPath())
	}
}

func TestConfigureReadCDNRejectsUnsafeBaseURL(t *testing.T) {
	signer, err := NewCOSSigner("example-1250000000", "ap-guangzhou", "id", "key")
	if err != nil {
		t.Fatal(err)
	}
	for _, baseURL := range []string{
		"http://media.example.com",
		"https://media.example.com/prefix",
		"https://media.example.com?token=leak",
	} {
		if err := signer.ConfigureReadCDN(baseURL, "auth-key", "sign"); err == nil {
			t.Fatalf("expected invalid base URL to fail: %s", baseURL)
		}
	}
}
