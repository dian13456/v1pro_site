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
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	allowedVID := os.Getenv("ALLOWED_VID")
	if allowedVID == "" {
		allowedVID = "0483"
	}
	allowedPID := os.Getenv("ALLOWED_PID")
	if allowedPID == "" {
		allowedPID = "66AA"
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

		if normalizeHexID(req.Vid) != normalizeHexID(allowedVID) || normalizeHexID(req.Pid) != normalizeHexID(allowedPID) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "设备 VID/PID 不匹配"})
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

		url, signErr := signer.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
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
