package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

type signedURLCacheEntry struct {
	url       string
	expiresAt time.Time
}

type likesStore struct {
	Counts      map[string]int             `json:"counts"`
	DeviceLikes map[string]map[string]bool `json:"deviceLikes"`
}

type likeRequest struct {
	ResourceID string `json:"resourceId"`
}

type runtimeResourceMap struct {
	path        string
	mu          sync.RWMutex
	data        resourceMap
	lastModTime time.Time
}

func newRuntimeResourceMap(path string) (*runtimeResourceMap, error) {
	m, err := loadResourceMap(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &runtimeResourceMap{
		path:        path,
		data:        m,
		lastModTime: info.ModTime(),
	}, nil
}

func (r *runtimeResourceMap) reloadIfChanged() error {
	info, err := os.Stat(r.path)
	if err != nil {
		return err
	}

	r.mu.RLock()
	lastModTime := r.lastModTime
	r.mu.RUnlock()
	if !info.ModTime().After(lastModTime) {
		return nil
	}

	latestMap, err := loadResourceMap(r.path)
	if err != nil {
		return err
	}

	r.mu.Lock()
	r.data = latestMap
	r.lastModTime = info.ModTime()
	r.mu.Unlock()
	return nil
}

func (r *runtimeResourceMap) get(id string) (string, bool) {
	if err := r.reloadIfChanged(); err != nil {
		log.Printf("warn: reload map %s failed: %v", r.path, err)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	value, ok := r.data[id]
	return value, ok
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

func loadLikesStore(path string) (likesStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return likesStore{
				Counts:      map[string]int{},
				DeviceLikes: map[string]map[string]bool{},
			}, nil
		}
		return likesStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return likesStore{
			Counts:      map[string]int{},
			DeviceLikes: map[string]map[string]bool{},
		}, nil
	}
	var store likesStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return likesStore{}, err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.DeviceLikes == nil {
		store.DeviceLikes = map[string]map[string]bool{}
	}
	return store, nil
}

func saveLikesStore(path string, store likesStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
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

func splitToken(token string) (payload string, signature string, ok bool) {
	token = strings.TrimSpace(token)
	lastDot := strings.LastIndex(token, ".")
	if lastDot <= 0 || lastDot >= len(token)-1 {
		return "", "", false
	}
	return token[:lastDot], token[lastDot+1:], true
}

func isSoftwareObjectKey(objectKey string) bool {
	key := strings.ToLower(strings.TrimSpace(objectKey))
	return strings.HasSuffix(key, ".exe")
}

func isVideoObjectKey(objectKey string) bool {
	key := strings.ToLower(strings.TrimSpace(objectKey))
	return strings.HasSuffix(key, ".mp4") ||
		strings.HasSuffix(key, ".mov") ||
		strings.HasSuffix(key, ".m4v") ||
		strings.HasSuffix(key, ".avi") ||
		strings.HasSuffix(key, ".mkv") ||
		strings.HasSuffix(key, ".webm") ||
		strings.HasSuffix(key, ".flv")
}

func isGIFObjectKey(objectKey string) bool {
	key := strings.ToLower(strings.TrimSpace(objectKey))
	return strings.HasSuffix(key, ".gif")
}

func normalizeObjectKey(raw string) string {
	key := strings.TrimSpace(raw)
	if key == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(key), "http://") || strings.HasPrefix(strings.ToLower(key), "https://") {
		parsed, err := url.Parse(key)
		if err == nil {
			decodedPath, decodeErr := url.PathUnescape(parsed.Path)
			if decodeErr == nil {
				key = decodedPath
			} else {
				key = parsed.Path
			}
		}
	}
	key = strings.TrimPrefix(strings.TrimSpace(key), "/")
	return key
}

func verifyToken(token string, jwtSecret string) bool {
	payload, signature, ok := splitToken(token)
	if !ok {
		return false
	}
	return signTokenPayload(payload, jwtSecret) == signature
}

func serialFromToken(token string, jwtSecret string) (string, bool) {
	if !verifyToken(token, jwtSecret) {
		return "", false
	}
	payload, _, ok := splitToken(token)
	if !ok {
		return "", false
	}
	// payload 格式：<serial>.<timestamp>，serial 允许包含 '.'，因此从最后一个 '.' 反向切分。
	lastDot := strings.LastIndex(payload, ".")
	if lastDot <= 0 {
		return "", false
	}
	serial := strings.TrimSpace(payload[:lastDot])
	return serial, serial != ""
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
	softwareCOSBucket := os.Getenv("SOFTWARE_COS_BUCKET")
	if softwareCOSBucket == "" {
		softwareCOSBucket = "v1pro-1311844229"
	}
	softwareCOSRegion := os.Getenv("SOFTWARE_COS_REGION")
	if softwareCOSRegion == "" {
		softwareCOSRegion = "ap-guangzhou"
	}
	softwareCOSSecretID := os.Getenv("SOFTWARE_COS_SECRET_ID")
	if softwareCOSSecretID == "" {
		softwareCOSSecretID = cosSecretID
	}
	softwareCOSSecretKey := os.Getenv("SOFTWARE_COS_SECRET_KEY")
	if softwareCOSSecretKey == "" {
		softwareCOSSecretKey = cosSecretKey
	}
	videoCOSBucket := os.Getenv("VIDEO_COS_BUCKET")
	if videoCOSBucket == "" {
		videoCOSBucket = "video-1311844229"
	}
	videoCOSRegion := os.Getenv("VIDEO_COS_REGION")
	if videoCOSRegion == "" {
		videoCOSRegion = "ap-guangzhou"
	}
	videoCOSSecretID := os.Getenv("VIDEO_COS_SECRET_ID")
	if videoCOSSecretID == "" {
		videoCOSSecretID = cosSecretID
	}
	videoCOSSecretKey := os.Getenv("VIDEO_COS_SECRET_KEY")
	if videoCOSSecretKey == "" {
		videoCOSSecretKey = cosSecretKey
	}
	gifCOSBucket := os.Getenv("GIF_COS_BUCKET")
	if gifCOSBucket == "" {
		gifCOSBucket = "gif-1311844229"
	}
	gifCOSRegion := os.Getenv("GIF_COS_REGION")
	if gifCOSRegion == "" {
		gifCOSRegion = "ap-guangzhou"
	}
	gifCOSSecretID := os.Getenv("GIF_COS_SECRET_ID")
	if gifCOSSecretID == "" {
		gifCOSSecretID = cosSecretID
	}
	gifCOSSecretKey := os.Getenv("GIF_COS_SECRET_KEY")
	if gifCOSSecretKey == "" {
		gifCOSSecretKey = cosSecretKey
	}
	videoCoverCOSBucket := os.Getenv("VIDEO_COVER_COS_BUCKET")
	if videoCoverCOSBucket == "" {
		videoCoverCOSBucket = imageCOSBucket
	}
	videoCoverCOSRegion := os.Getenv("VIDEO_COVER_COS_REGION")
	if videoCoverCOSRegion == "" {
		videoCoverCOSRegion = imageCOSRegion
	}
	videoCoverCOSSecretID := os.Getenv("VIDEO_COVER_COS_SECRET_ID")
	if videoCoverCOSSecretID == "" {
		videoCoverCOSSecretID = cosSecretID
	}
	videoCoverCOSSecretKey := os.Getenv("VIDEO_COVER_COS_SECRET_KEY")
	if videoCoverCOSSecretKey == "" {
		videoCoverCOSSecretKey = cosSecretKey
	}
	gifCoverCOSBucket := os.Getenv("GIF_COVER_COS_BUCKET")
	if gifCoverCOSBucket == "" {
		gifCoverCOSBucket = "gif-cover-1311844229"
	}
	gifCoverCOSRegion := os.Getenv("GIF_COVER_COS_REGION")
	if gifCoverCOSRegion == "" {
		gifCoverCOSRegion = "ap-guangzhou"
	}
	gifCoverCOSSecretID := os.Getenv("GIF_COVER_COS_SECRET_ID")
	if gifCoverCOSSecretID == "" {
		gifCoverCOSSecretID = cosSecretID
	}
	gifCoverCOSSecretKey := os.Getenv("GIF_COVER_COS_SECRET_KEY")
	if gifCoverCOSSecretKey == "" {
		gifCoverCOSSecretKey = cosSecretKey
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
	resourceLikesPath := os.Getenv("RESOURCE_LIKES_PATH")
	if resourceLikesPath == "" {
		resourceLikesPath = filepath.Join("config", "resource_likes.json")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	resourceMapStore, err := newRuntimeResourceMap(resourceMapPath)
	if err != nil {
		log.Fatalf("load resource map failed: %v", err)
	}
	imageMapStore, err := newRuntimeResourceMap(imageMapPath)
	if err != nil {
		log.Fatalf("load image map failed: %v", err)
	}
	likes, err := loadLikesStore(resourceLikesPath)
	if err != nil {
		log.Fatalf("load resource likes failed: %v", err)
	}

	signer, err := service.NewCOSSigner(cosBucket, cosRegion, cosSecretID, cosSecretKey)
	if err != nil {
		log.Fatalf("init cos signer failed: %v", err)
	}
	imageSigner, err := service.NewCOSSigner(imageCOSBucket, imageCOSRegion, imageCOSSecretID, imageCOSSecretKey)
	if err != nil {
		log.Fatalf("init image cos signer failed: %v", err)
	}
	softwareSigner, err := service.NewCOSSigner(
		softwareCOSBucket,
		softwareCOSRegion,
		softwareCOSSecretID,
		softwareCOSSecretKey,
	)
	if err != nil {
		log.Fatalf("init software cos signer failed: %v", err)
	}
	videoSigner, err := service.NewCOSSigner(
		videoCOSBucket,
		videoCOSRegion,
		videoCOSSecretID,
		videoCOSSecretKey,
	)
	if err != nil {
		log.Fatalf("init video cos signer failed: %v", err)
	}
	gifSigner, err := service.NewCOSSigner(
		gifCOSBucket,
		gifCOSRegion,
		gifCOSSecretID,
		gifCOSSecretKey,
	)
	if err != nil {
		log.Fatalf("init gif cos signer failed: %v", err)
	}
	videoCoverSigner, err := service.NewCOSSigner(
		videoCoverCOSBucket,
		videoCoverCOSRegion,
		videoCoverCOSSecretID,
		videoCoverCOSSecretKey,
	)
	if err != nil {
		log.Fatalf("init video cover cos signer failed: %v", err)
	}
	gifCoverSigner, err := service.NewCOSSigner(
		gifCoverCOSBucket,
		gifCoverCOSRegion,
		gifCoverCOSSecretID,
		gifCoverCOSSecretKey,
	)
	if err != nil {
		log.Fatalf("init gif cover cos signer failed: %v", err)
	}
	imageURLCache := map[string]signedURLCacheEntry{}
	var imageURLCacheMu sync.RWMutex
	var likesMu sync.RWMutex
	imageSignTTL := 10 * time.Minute
	// 给缓存留 30 秒安全边界，避免返回临过期签名链接。
	imageCacheReuseTTL := imageSignTTL - 30*time.Second

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

	router.GET("/api/resource-likes", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		likesMu.RLock()
		counts := make(map[string]int, len(likes.Counts))
		for id, count := range likes.Counts {
			if count < 0 {
				count = 0
			}
			counts[id] = count
		}
		likedMap := likes.DeviceLikes[serial]
		likedResourceIDs := make([]string, 0, len(likedMap))
		for id, liked := range likedMap {
			if liked {
				likedResourceIDs = append(likedResourceIDs, id)
			}
		}
		likesMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":          true,
			"counts":           counts,
			"likedResourceIds": likedResourceIDs,
		})
	})

	router.POST("/api/resource-like", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req likeRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ResourceID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)

		likesMu.Lock()
		if likes.DeviceLikes[serial] == nil {
			likes.DeviceLikes[serial] = map[string]bool{}
		}
		alreadyLiked := likes.DeviceLikes[serial][resourceID]
		if !alreadyLiked {
			likes.DeviceLikes[serial][resourceID] = true
			likes.Counts[resourceID] = likes.Counts[resourceID] + 1
		}
		likeCount := likes.Counts[resourceID]
		if likeCount < 0 {
			likeCount = 0
		}
		saveErr := saveLikesStore(resourceLikesPath, likes)
		likesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "点赞保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":      true,
			"alreadyLiked": alreadyLiked,
			"liked":        true,
			"likeCount":    likeCount,
		})
	})

	handleResource := func(c *gin.Context, id string) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}

		rawObjectKey, ok := resourceMapStore.get(id)
		objectKey := normalizeObjectKey(rawObjectKey)
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		}

		selectedSigner := signer
		if isSoftwareObjectKey(objectKey) {
			selectedSigner = softwareSigner
		} else if isGIFObjectKey(objectKey) {
			selectedSigner = gifSigner
		} else if isVideoObjectKey(objectKey) {
			selectedSigner = videoSigner
		}

		url, signErr := selectedSigner.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
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

		rawImageObjectKey, ok := imageMapStore.get(id)
		objectKey := normalizeObjectKey(rawImageObjectKey)
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
			return
		}

		selectedImageSigner := imageSigner
		cacheKeyPrefix := "image:"
		if rawResourceObjectKey, hasResource := resourceMapStore.get(id); hasResource {
			resourceObjectKey := normalizeObjectKey(rawResourceObjectKey)
			if isVideoObjectKey(resourceObjectKey) {
				selectedImageSigner = videoCoverSigner
				cacheKeyPrefix = "video-cover:"
			} else if isGIFObjectKey(resourceObjectKey) {
				selectedImageSigner = gifCoverSigner
				cacheKeyPrefix = "gif-cover:"
			}
		}
		cacheKey := cacheKeyPrefix + objectKey

		now := time.Now()
		imageURLCacheMu.RLock()
		cached, hasCached := imageURLCache[cacheKey]
		imageURLCacheMu.RUnlock()
		if hasCached && cached.expiresAt.After(now) {
			c.JSON(http.StatusOK, gin.H{"url": cached.url})
			return
		}

		url, signErr := selectedImageSigner.GenerateReadURL(c.Request.Context(), objectKey, imageSignTTL)
		if signErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign image url failed"})
			return
		}
		imageURLCacheMu.Lock()
		imageURLCache[cacheKey] = signedURLCacheEntry{
			url:       url,
			expiresAt: now.Add(imageCacheReuseTTL),
		}
		imageURLCacheMu.Unlock()

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
