package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

const (
	defaultRequestBodyLimit = int64(12 << 20)
	imageUploadBodyLimit    = int64(6 << 20)
	gifUploadBodyLimit      = int64(17 << 20)
	videoUploadBodyLimit    = int64(22 << 20)
)

func maxRequestBodyBytes(path string) int64 {
	switch path {
	case "/api/user-video/upload":
		return videoUploadBodyLimit
	case "/api/user-gif/upload":
		return gifUploadBodyLimit
	case "/api/activity/promo/upload-image", "/api/admin/mall/upload-image":
		return imageUploadBodyLimit
	default:
		return defaultRequestBodyLimit
	}
}

func requestBodyLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil || c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		limit := maxRequestBodyBytes(c.Request.URL.Path)
		if c.Request.ContentLength > limit {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"success": false,
				"message": "请求内容过大",
			})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	}
}

func securityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		c.Header("Strict-Transport-Security", "max-age=31536000")

		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/admin/") ||
			strings.HasPrefix(path, "/api/profile") ||
			strings.HasPrefix(path, "/api/mall/orders") ||
			strings.HasPrefix(path, "/api/activity/promo") ||
			strings.HasPrefix(path, "/api/activity/lottery/prize-info") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

func adminRateLimitMiddleware(limiter *service.IPRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if limiter != nil && strings.HasPrefix(c.Request.URL.Path, "/api/admin/") {
			clientIP := service.ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP"))
			if !limiter.Allow(clientIP) {
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "管理接口请求过于频繁"})
				return
			}
		}
		c.Next()
	}
}

func durationFromEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		log.Printf("warn: invalid %s=%q, using %s", name, raw, fallback)
		return fallback
	}
	return value
}

func intFromEnv(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		log.Printf("warn: invalid %s=%q, using %d", name, raw, fallback)
		return fallback
	}
	return value
}

func newAPIHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12},
		ReadHeaderTimeout: durationFromEnv("HTTP_READ_HEADER_TIMEOUT", 10*time.Second),
		ReadTimeout:       durationFromEnv("HTTP_READ_TIMEOUT", 2*time.Minute),
		WriteTimeout:      durationFromEnv("HTTP_WRITE_TIMEOUT", 5*time.Minute),
		IdleTimeout:       durationFromEnv("HTTP_IDLE_TIMEOUT", 60*time.Second),
		MaxHeaderBytes:    intFromEnv("HTTP_MAX_HEADER_BYTES", 32<<10),
	}
}

func apiListenAddr(port string) string {
	if addr := strings.TrimSpace(os.Getenv("LISTEN_ADDR")); addr != "" {
		return addr
	}
	return ":" + strings.TrimSpace(port)
}

func apiTLSFiles() (certFile string, keyFile string, err error) {
	certFile = strings.TrimSpace(os.Getenv("TLS_CERT_FILE"))
	keyFile = strings.TrimSpace(os.Getenv("TLS_KEY_FILE"))
	if certFile == "" && keyFile == "" {
		return "", "", nil
	}
	if certFile == "" || keyFile == "" {
		return "", "", fmt.Errorf("TLS_CERT_FILE and TLS_KEY_FILE must be configured together")
	}
	return certFile, keyFile, nil
}

func runAPIHTTPServer(server *http.Server) error {
	certFile, keyFile, err := apiTLSFiles()
	if err != nil {
		return err
	}
	serverErrors := make(chan error, 1)
	go func() {
		if certFile != "" {
			log.Printf("API HTTPS listening on %s", server.Addr)
			serverErrors <- server.ListenAndServeTLS(certFile, keyFile)
			return
		}
		log.Printf("API HTTP listening on %s", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(shutdownSignals)

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case sig := <-shutdownSignals:
		log.Printf("received %s, shutting down", sig)
	}

	ctx, cancel := context.WithTimeout(context.Background(), durationFromEnv("HTTP_SHUTDOWN_TIMEOUT", 20*time.Second))
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		_ = server.Close()
		return err
	}
	return nil
}
