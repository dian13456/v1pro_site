package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

type resourceMap map[string]string

type authRequest struct {
	Serial string `json:"serial"`
	Vid    string `json:"vid"`
	Pid    string `json:"pid"`
}

func loadResourceMap(path string) (resourceMap, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var m resourceMap
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func normalizeHexID(v string) string {
	return strings.ToUpper(strings.TrimSpace(v))
}

type usbDevicePair struct {
	vid string
	pid string
}

func loadAllowedDevices(raw string) []usbDevicePair {
	if strings.TrimSpace(raw) == "" {
		raw = "0483:66AA,2E3C:5753"
	}
	pairs := make([]usbDevicePair, 0)
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.Split(item, ":")
		if len(parts) != 2 {
			continue
		}
		pairs = append(pairs, usbDevicePair{
			vid: normalizeHexID(parts[0]),
			pid: normalizeHexID(parts[1]),
		})
	}
	return pairs
}

func isAllowedDevice(vid, pid string, allowed []usbDevicePair) bool {
	normalizedVID := normalizeHexID(vid)
	normalizedPID := normalizeHexID(pid)
	for _, pair := range allowed {
		if pair.vid == normalizedVID && pair.pid == normalizedPID {
			return true
		}
	}
	return false
}

func signTokenPayload(payload string, jwtSecret string) string {
	sum := sha256.Sum256([]byte(payload + "." + jwtSecret))
	return fmt.Sprintf("%x", sum[:])
}

func createToken(serial string, jwtSecret string) string {
	payload := fmt.Sprintf("%s.%d", serial, time.Now().UnixMilli())
	signature := signTokenPayload(payload, jwtSecret)
	return payload + "." + signature
}

func verifyToken(token string, jwtSecret string) bool {
	parts := strings.Split(token, ".")
	if len(parts) < 3 {
		return false
	}
	payload := parts[0] + "." + parts[1]
	signature := strings.Join(parts[2:], ".")
	return signTokenPayload(payload, jwtSecret) == signature
}

func parseBearerToken(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
}

func corsMiddleware(allowOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if allowOrigin == "*" {
			if origin != "" {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			} else {
				c.Header("Access-Control-Allow-Origin", "*")
			}
		} else {
			c.Header("Access-Control-Allow-Origin", allowOrigin)
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Allow-Credentials", "false")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func main() {
	cosBucket := os.Getenv("COS_BUCKET")
	cosRegion := os.Getenv("COS_REGION")
	cosSecretID := os.Getenv("COS_SECRET_ID")
	cosSecretKey := os.Getenv("COS_SECRET_KEY")
	imageCOSBucket := os.Getenv("IMAGE_COS_BUCKET")
	if imageCOSBucket == "" {
		imageCOSBucket = cosBucket
	}
	imageCOSRegion := os.Getenv("IMAGE_COS_REGION")
	if imageCOSRegion == "" {
		imageCOSRegion = cosRegion
	}
	imageCOSSecretID := os.Getenv("IMAGE_COS_SECRET_ID")
	if imageCOSSecretID == "" {
		imageCOSSecretID = cosSecretID
	}
	imageCOSSecretKey := os.Getenv("IMAGE_COS_SECRET_KEY")
	if imageCOSSecretKey == "" {
		imageCOSSecretKey = cosSecretKey
	}
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	allowedDevicesRaw := os.Getenv("ALLOWED_DEVICES")
	if allowedDevicesRaw == "" {
		// 兼容旧配置：未设置 ALLOWED_DEVICES 时使用 ALLOWED_VID/ALLOWED_PID
		legacyVID := os.Getenv("ALLOWED_VID")
		if legacyVID == "" {
			legacyVID = "0483"
		}
		legacyPID := os.Getenv("ALLOWED_PID")
		if legacyPID == "" {
			legacyPID = "66AA"
		}
		allowedDevicesRaw = legacyVID + ":" + legacyPID + ",2E3C:5753"
	}
	allowedDevices := loadAllowedDevices(allowedDevicesRaw)
	if len(allowedDevices) == 0 {
		log.Fatal("ALLOWED_DEVICES is empty or invalid")
	}
	corsAllowOrigin := os.Getenv("CORS_ALLOW_ORIGIN")
	if corsAllowOrigin == "" {
		corsAllowOrigin = "*"
	}

	resourceMapPath := os.Getenv("RESOURCE_MAP_PATH")
	if resourceMapPath == "" {
		resourceMapPath = filepath.Join("config", "resource_map.json")
	}
	imageMapPath := os.Getenv("IMAGE_MAP_PATH")
	if imageMapPath == "" {
		imageMapPath = filepath.Join("config", "image_map.json")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mapping, err := loadResourceMap(resourceMapPath)
	if err != nil {
		log.Fatalf("load resource map failed: %v", err)
	}
	imageMapping, err := loadResourceMap(imageMapPath)
	if err != nil {
		log.Fatalf("load image map failed: %v", err)
	}

	signer, err := service.NewCOSSigner(cosBucket, cosRegion, cosSecretID, cosSecretKey)
	if err != nil {
		log.Fatalf("init cos signer failed: %v", err)
	}
	imageSigner, err := service.NewCOSSigner(imageCOSBucket, imageCOSRegion, imageCOSSecretID, imageCOSSecretKey)
	if err != nil {
		log.Fatalf("init image cos signer failed: %v", err)
	}

	router := gin.Default()
	router.Use(corsMiddleware(corsAllowOrigin))

	router.POST("/api/auth", func(c *gin.Context) {
		var req authRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数不完整"})
			return
		}
		if req.Serial == "" || req.Vid == "" || req.Pid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数不完整"})
			return
		}

		if !isAllowedDevice(req.Vid, req.Pid, allowedDevices) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "设备不匹配，请购买正规产品"})
			return
		}

		token := createToken(req.Serial, jwtSecret)
		c.JSON(http.StatusOK, gin.H{"success": true, "token": token})
	})

	router.GET("/api/verify-token", func(c *gin.Context) {
		token := parseBearerToken(c)
		valid := verifyToken(token, jwtSecret)
		c.JSON(http.StatusOK, gin.H{"success": valid})
	})

	handleResource := func(c *gin.Context, id string) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}

		objectKey, ok := mapping[id]
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		}

		url, signErr := signer.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
		if signErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign url failed"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"url": url})
	}

	handleImage := func(c *gin.Context, id string) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}

		objectKey, ok := imageMapping[id]
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
			return
		}

		url, signErr := imageSigner.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
		if signErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign image url failed"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"url": url})
	}

	router.GET("/api/resource/:id", func(c *gin.Context) {
		handleResource(c, c.Param("id"))
	})
	router.GET("/api/resource/", func(c *gin.Context) {
		handleResource(c, c.Query("id"))
	})
	router.GET("/api/image/:id", func(c *gin.Context) {
		handleImage(c, c.Param("id"))
	})
	router.GET("/api/image/", func(c *gin.Context) {
		handleImage(c, c.Query("id"))
	})

	if err := router.Run(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server run failed: %v", err)
	}
}
