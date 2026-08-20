package service

import "testing"

func TestClientIPIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	got := ClientIP("198.51.100.10:4321", "203.0.113.5", "203.0.113.6")
	if got != "198.51.100.10" {
		t.Fatalf("expected direct peer IP, got %q", got)
	}
}

func TestClientIPUsesReverseProxyHeadersFromLoopback(t *testing.T) {
	if got := ClientIP("127.0.0.1:4321", "198.51.100.1, 203.0.113.5", "203.0.113.6"); got != "203.0.113.6" {
		t.Fatalf("expected X-Real-IP, got %q", got)
	}
	if got := ClientIP("[::1]:4321", "198.51.100.1, 203.0.113.5", ""); got != "203.0.113.5" {
		t.Fatalf("expected right-most forwarded IP, got %q", got)
	}
}
