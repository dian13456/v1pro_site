package main

import "testing"

func TestAPIListenAddr(t *testing.T) {
	t.Setenv("LISTEN_ADDR", "127.0.0.1:9443")
	if got := apiListenAddr("8080"); got != "127.0.0.1:9443" {
		t.Fatalf("unexpected listen addr: %q", got)
	}

	t.Setenv("LISTEN_ADDR", "")
	if got := apiListenAddr("8080"); got != ":8080" {
		t.Fatalf("unexpected default listen addr: %q", got)
	}
}

func TestAPITLSFiles(t *testing.T) {
	t.Setenv("TLS_CERT_FILE", "")
	t.Setenv("TLS_KEY_FILE", "")
	certFile, keyFile, err := apiTLSFiles()
	if err != nil || certFile != "" || keyFile != "" {
		t.Fatalf("expected HTTP mode, cert=%q key=%q err=%v", certFile, keyFile, err)
	}

	t.Setenv("TLS_CERT_FILE", "/tmp/cert.pem")
	t.Setenv("TLS_KEY_FILE", "/tmp/key.pem")
	certFile, keyFile, err = apiTLSFiles()
	if err != nil || certFile == "" || keyFile == "" {
		t.Fatalf("expected TLS mode, cert=%q key=%q err=%v", certFile, keyFile, err)
	}
}

func TestAPITLSFilesRejectPartialConfiguration(t *testing.T) {
	t.Setenv("TLS_CERT_FILE", "/tmp/cert.pem")
	t.Setenv("TLS_KEY_FILE", "")
	if _, _, err := apiTLSFiles(); err == nil {
		t.Fatal("expected partial TLS configuration to fail")
	}
}
