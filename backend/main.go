package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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

type likeRequest struct {
	ResourceID string `json:"resourceId"`
}

type shopRedeemRequest struct {
	ItemID   string `json:"itemId"`
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Wechat   string `json:"wechat"`
	QQ       string `json:"qq"`
	Province string `json:"province"`
	City     string `json:"city"`
	Address  string `json:"address"`
	Remark   string `json:"remark"`
}

type favoriteRequest struct {
	ResourceID string `json:"resourceId"`
	Action     string `json:"action"`
}

type hiddenResourceRequest struct {
	ResourceID string `json:"resourceId"`
	Hidden     bool   `json:"hidden"`
}

type followResourceRequest struct {
	ResourceID string `json:"resourceId"`
	Followed   bool   `json:"followed"`
}

type downloadRequest struct {
	ResourceID string `json:"resourceId"`
}

type resourceInteractionRequest struct {
	ResourceID string `json:"resourceId"`
	Action     string `json:"action"`
}

const (
	maxMessageLength   = 500
	maxMessagesPerPage = 100
)

type profilePostRequest struct {
	DisplayName string `json:"displayName"`
}

type deviceFeatureActivationRequest struct {
	Code string `json:"code"`
}

type profileAvatarUploadRequest struct {
	ImageBase64 string `json:"imageBase64"`
	ContentType string `json:"contentType"`
}

type softwarePromptDismissRequest struct {
	ResourceID int64 `json:"resourceId"`
}

type profileUploadDeleteRequest struct {
	Kind       string `json:"kind"`
	ResourceID string `json:"resourceId"`
	ReviewID   string `json:"reviewId"`
}

type profileUploadTitleRequest struct {
	Kind       string `json:"kind"`
	ResourceID string `json:"resourceId"`
	ReviewID   string `json:"reviewId"`
	Title      string `json:"title"`
}

type messagePostRequest struct {
	Content     string `json:"content"`
	DisplayName string `json:"displayName"`
	ResourceID  string `json:"resourceId"`
}

type aiGuideRequest struct {
	Question string `json:"question"`
}

type aiImageRequest struct {
	Prompt      string `json:"prompt"`
	AspectRatio string `json:"aspectRatio"`
	Count       int    `json:"count"`
}

type aiImageTransferRequest struct {
	ImageBase64 string `json:"imageBase64"`
	FileName    string `json:"fileName"`
	Source      string `json:"source"`
}

type aiImageShareRequest struct {
	ImageBase64 string `json:"imageBase64"`
	Prompt      string `json:"prompt"`
	Title       string `json:"title"`
	Source      string `json:"source"`
}

type userImageShareRequest struct {
	ImageBase64      string                            `json:"imageBase64"`
	Title            string                            `json:"title"`
	Description      string                            `json:"description"`
	TransferDefaults *service.ResourceTransferDefaults `json:"transferDefaults,omitempty"`
}

type userGifUploadSessionRequest struct {
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
}

type userGifShareRequest struct {
	SessionID        string                            `json:"sessionId"`
	Title            string                            `json:"title"`
	Description      string                            `json:"description"`
	TransferDefaults *service.ResourceTransferDefaults `json:"transferDefaults,omitempty"`
}

type userVideoUploadSessionRequest struct {
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
}

type userVideoShareRequest struct {
	SessionID        string                            `json:"sessionId"`
	Title            string                            `json:"title"`
	Description      string                            `json:"description"`
	ColumnTag        string                            `json:"columnTag"`
	TransferDefaults *service.ResourceTransferDefaults `json:"transferDefaults,omitempty"`
}

type imageReviewActionRequest struct {
	Note string `json:"note"`
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

func (r *runtimeResourceMap) remove(id string) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	r.mu.Lock()
	delete(r.data, id)
	if info, err := os.Stat(r.path); err == nil {
		r.lastModTime = info.ModTime()
	} else {
		r.lastModTime = time.Now()
	}
	r.mu.Unlock()
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

func loadResourceCatalog(path string) ([]map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func loadColumnTags(path string) ([]map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func displayUsernameFromSerial(serial string) string {
	s := strings.TrimSpace(serial)
	if s == "" {
		return "anonymous"
	}
	runes := []rune(s)
	if len(runes) <= 10 {
		return s
	}
	return string(runes[len(runes)-10:])
}

func newMessageID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%d-%s", time.Now().UnixMilli(), hex.EncodeToString(buf))
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
	return service.SignTokenPayload(payload, jwtSecret)
}

func createToken(serial string, jwtSecret string) string {
	return service.CreateToken(serial, jwtSecret)
}

func verifyToken(token string, jwtSecret string, tokenTTL time.Duration) bool {
	return service.VerifyToken(token, jwtSecret, tokenTTL)
}

func serialFromToken(token string, jwtSecret string, tokenTTL time.Duration) (string, bool) {
	return service.SerialFromToken(token, jwtSecret, tokenTTL)
}

func parseRateLimitPerMin(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 {
		return fallback
	}
	return limit
}

func parseAuthRateLimitPerMin(raw string) int {
	if !service.ApiRateLimitsEnabled() {
		return 0
	}
	return parseRateLimitPerMin(raw, 10)
}

func endpointRateLimitPerMin(raw string, fallback int) int {
	if !service.ApiRateLimitsEnabled() {
		return 0
	}
	return parseRateLimitPerMin(raw, fallback)
}

func ginClientIP(c *gin.Context) string {
	return service.ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP"))
}

func rateLimitRejected(
	c *gin.Context,
	tokenLimiter, ipLimiter *service.IPRateLimiter,
	serial, tooManyMsg string,
) bool {
	if !service.AllowTokenAndIP(tokenLimiter, ipLimiter, serial, ginClientIP(c)) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": tooManyMsg})
		return true
	}
	return false
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

func contentTypeFromObjectKey(objectKey string) string {
	key := strings.ToLower(strings.TrimSpace(objectKey))
	switch {
	case strings.HasSuffix(key, ".gif"):
		return "image/gif"
	case strings.HasSuffix(key, ".png"):
		return "image/png"
	case strings.HasSuffix(key, ".webp"):
		return "image/webp"
	case strings.HasSuffix(key, ".jpg"), strings.HasSuffix(key, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(key, ".mp4"), strings.HasSuffix(key, ".m4v"):
		return "video/mp4"
	case strings.HasSuffix(key, ".webm"):
		return "video/webm"
	case strings.HasSuffix(key, ".mov"):
		return "video/quicktime"
	default:
		return "application/octet-stream"
	}
}

func writeTransferBlob(c *gin.Context, signer *service.COSSigner, objectKey string) bool {
	if signer == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage signer unavailable"})
		return false
	}
	reader, err := signer.OpenObject(c.Request.Context(), objectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "read object failed"})
		return false
	}
	defer reader.Body.Close()
	contentType := strings.TrimSpace(reader.ContentType)
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = contentTypeFromObjectKey(objectKey)
	}
	c.Header("Cache-Control", "no-store")
	c.DataFromReader(http.StatusOK, reader.ContentLength, contentType, reader.Body, nil)
	return true
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

func parseBearerToken(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
}

var imsAigcModerationType = "IMAGE_AIGC"

func isAIGeneratedSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "upload", "user":
		return false
	default:
		return true
	}
}

func imsModerationType(source string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "ai", "aigc":
		return imsAigcModerationType
	case "upload", "user":
		return "IMAGE"
	default:
		if fallback == "" {
			return "IMAGE"
		}
		return fallback
	}
}

func writeImageModerationError(c *gin.Context, err error) {
	status := http.StatusUnprocessableEntity
	if !service.IsImageModerationRejected(err) && !service.IsImageModerationReview(err) {
		status = http.StatusBadGateway
	}
	c.JSON(status, gin.H{"success": false, "message": err.Error()})
}

func writeImageReviewPending(c *gin.Context, item service.PendingImageReview) {
	c.JSON(http.StatusAccepted, gin.H{
		"success":       false,
		"pendingReview": true,
		"reviewId":      item.ID,
		"message":       "图片已提交人工复核，请等待管理员审核",
		"label":         item.Label,
		"subLabel":      item.SubLabel,
		"score":         item.Score,
	})
}

func ensureReviewAdmin(c *gin.Context, reviewAdminToken string) bool {
	if strings.TrimSpace(reviewAdminToken) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "人工复核接口未配置"})
		return false
	}
	token := strings.TrimSpace(c.GetHeader("X-Review-Admin-Token"))
	expectedHash := sha256.Sum256([]byte(reviewAdminToken))
	actualHash := sha256.Sum256([]byte(token))
	if token == "" || subtle.ConstantTimeCompare(actualHash[:], expectedHash[:]) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "复核管理员 token 无效"})
		return false
	}
	return true
}

func parseCorsAllowOrigins(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "*" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func corsOriginAllowed(origin string, allowed []string) bool {
	for _, item := range allowed {
		if strings.EqualFold(origin, item) {
			return true
		}
	}
	return false
}

func corsMiddleware(allowOrigin string) gin.HandlerFunc {
	allowed := parseCorsAllowOrigins(allowOrigin)
	wildcard := strings.TrimSpace(allowOrigin) == "*"
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" {
			c.Header("Vary", "Origin")
			switch {
			case wildcard:
				c.Header("Access-Control-Allow-Origin", "*")
			case corsOriginAllowed(origin, allowed):
				c.Header("Access-Control-Allow-Origin", origin)
			default:
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "message": "来源站点不允许访问 API"})
				return
			}
		} else if wildcard {
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Review-Admin-Token, X-Api-Timestamp, X-Api-Nonce, X-Api-Signature")
		c.Header("Access-Control-Allow-Credentials", "false")
		c.Header("Access-Control-Max-Age", "600")
		c.Header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet")

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
	apiSignSecret, apiSignMaxSkew, apiSignRequired := service.APISignConfigFromEnv()
	if apiSignRequired && apiSignSecret == "" {
		log.Fatal("API_SIGN_SECRET is required when API_SIGN_REQUIRED is enabled")
	}
	if apiSignSecret == "" {
		log.Printf("warn: API_SIGN_SECRET not set, request signature verification disabled")
	}
	apiSignVerifier := service.NewAPISignVerifier(apiSignSecret, apiSignMaxSkew, apiSignRequired)
	tokenTTL := service.ParseTokenTTLDays(os.Getenv("TOKEN_TTL_DAYS"))
	authRateLimiter := service.NewIPRateLimiter(parseAuthRateLimitPerMin(os.Getenv("AUTH_RATE_LIMIT_PER_MIN")), time.Minute)
	aiTokenRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("AI_RATE_LIMIT_TOKEN_PER_MIN"), 10), time.Minute)
	aiIPRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("AI_RATE_LIMIT_IP_PER_MIN"), 30), time.Minute)
	messageTokenRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("MESSAGE_RATE_LIMIT_TOKEN_PER_MIN"), 5), time.Minute)
	messageIPRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("MESSAGE_RATE_LIMIT_IP_PER_MIN"), 15), time.Minute)
	likeTokenRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("LIKE_RATE_LIMIT_TOKEN_PER_MIN"), 30), time.Minute)
	likeIPRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("LIKE_RATE_LIMIT_IP_PER_MIN"), 60), time.Minute)
	activityTokenRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("ACTIVITY_RATE_LIMIT_TOKEN_PER_MIN"), 8), time.Minute)
	activityIPRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("ACTIVITY_RATE_LIMIT_IP_PER_MIN"), 20), time.Minute)
	adminIPRateLimiter := service.NewIPRateLimiter(endpointRateLimitPerMin(os.Getenv("ADMIN_RATE_LIMIT_IP_PER_MIN"), 120), time.Minute)
	abuseGuard := service.NewAbuseGuard(service.AbuseGuardConfigFromEnv())
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
		allowedDevicesRaw = legacyVID + ":" + legacyPID + ",0483:66AB,2E3C:5753"
	}
	allowedDevices := loadAllowedDevices(allowedDevicesRaw)
	if len(allowedDevices) == 0 {
		log.Fatal("ALLOWED_DEVICES is empty or invalid")
	}
	corsAllowOrigin := strings.TrimSpace(os.Getenv("CORS_ALLOW_ORIGIN"))
	if corsAllowOrigin == "" {
		corsAllowOrigin = "http://localhost:5173,http://127.0.0.1:5173"
		log.Printf("warn: CORS_ALLOW_ORIGIN not set; only local development origins are allowed")
	} else if corsAllowOrigin == "*" {
		log.Printf("warn: CORS_ALLOW_ORIGIN=* permits every website to call the API")
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
	resourceFavoritesPath := os.Getenv("RESOURCE_FAVORITES_PATH")
	if resourceFavoritesPath == "" {
		resourceFavoritesPath = filepath.Join("config", "resource_favorites.json")
	}
	blockedUploadersPath := os.Getenv("BLOCKED_UPLOADERS_PATH")
	if blockedUploadersPath == "" {
		blockedUploadersPath = filepath.Join("config", "blocked_uploaders.json")
	}
	followedUploadersPath := os.Getenv("FOLLOWED_UPLOADERS_PATH")
	if followedUploadersPath == "" {
		followedUploadersPath = filepath.Join("config", "followed_uploaders.json")
	}
	resourceDownloadsPath := os.Getenv("RESOURCE_DOWNLOADS_PATH")
	if resourceDownloadsPath == "" {
		resourceDownloadsPath = filepath.Join("config", "resource_downloads.json")
	}
	messageBoardPath := os.Getenv("MESSAGE_BOARD_PATH")
	if messageBoardPath == "" {
		messageBoardPath = filepath.Join("config", "message_board.json")
	}
	userProfilesPath := os.Getenv("USER_PROFILES_PATH")
	if userProfilesPath == "" {
		userProfilesPath = filepath.Join("config", "user_profiles.json")
	}
	userPromptPrefsPath := os.Getenv("USER_PROMPT_PREFS_PATH")
	if userPromptPrefsPath == "" {
		userPromptPrefsPath = filepath.Join("config", "user_prompt_prefs.json")
	}
	aiImageSharesPath := os.Getenv("AI_IMAGE_SHARES_PATH")
	if aiImageSharesPath == "" {
		aiImageSharesPath = filepath.Join("config", "ai_image_share_counts.json")
	}
	aiImageSharesUnlimitedPath := os.Getenv("AI_IMAGE_SHARES_UNLIMITED_PATH")
	if aiImageSharesUnlimitedPath == "" {
		aiImageSharesUnlimitedPath = filepath.Join("config", "ai_image_share_unlimited.json")
	}
	aiImageCreditsPath := os.Getenv("AI_IMAGE_CREDITS_PATH")
	if aiImageCreditsPath == "" {
		aiImageCreditsPath = filepath.Join("config", "ai_image_credits.json")
	}
	aiCreditLedgerPath := os.Getenv("AI_CREDIT_LEDGER_PATH")
	if aiCreditLedgerPath == "" {
		aiCreditLedgerPath = filepath.Join("config", "ai_credit_ledger.json")
	}
	creditLikeGrantsPath := os.Getenv("CREDIT_LIKE_GRANTS_PATH")
	if creditLikeGrantsPath == "" {
		creditLikeGrantsPath = filepath.Join("config", "credit_like_grants.json")
	}
	creditDailyRewardsPath := os.Getenv("CREDIT_DAILY_REWARDS_PATH")
	if creditDailyRewardsPath == "" {
		creditDailyRewardsPath = filepath.Join("config", "credit_daily_rewards.json")
	}
	shopItemsPath := os.Getenv("SHOP_ITEMS_PATH")
	if shopItemsPath == "" {
		shopItemsPath = filepath.Join("config", "shop_items.json")
	}
	resourcesPath := os.Getenv("RESOURCES_PATH")
	if resourcesPath == "" {
		resourcesPath = filepath.Join("..", "src", "data", "resources.json")
	}
	columnTagsPath := os.Getenv("COLUMN_TAGS_PATH")
	if columnTagsPath == "" {
		columnTagsPath = filepath.Join("..", "src", "data", "columnTags.json")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	deepseekAPIKey := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))
	deepseekModel := strings.TrimSpace(os.Getenv("DEEPSEEK_MODEL"))
	deepseekBaseURL := strings.TrimSpace(os.Getenv("DEEPSEEK_BASE_URL"))
	deepseekClient := service.NewDeepSeekClient(deepseekAPIKey, deepseekModel, deepseekBaseURL)
	if deepseekAPIKey == "" {
		log.Printf("warn: DEEPSEEK_API_KEY not set, /api/ai-guide will use keyword fallback")
	}
	minimaxAPIKey := strings.TrimSpace(os.Getenv("MINIMAX_API_KEY"))
	minimaxModel := strings.TrimSpace(os.Getenv("MINIMAX_MODEL"))
	minimaxBaseURL := strings.TrimSpace(os.Getenv("MINIMAX_BASE_URL"))
	minimaxGroupID := strings.TrimSpace(os.Getenv("MINIMAX_GROUP_ID"))
	minimaxClient := service.NewMiniMaxClient(minimaxAPIKey, minimaxModel, minimaxBaseURL, minimaxGroupID)
	if minimaxAPIKey == "" {
		log.Printf("warn: MINIMAX_API_KEY not set, /api/ai-image will be unavailable")
	}
	imsSecretID := strings.TrimSpace(os.Getenv("IMS_SECRET_ID"))
	if imsSecretID == "" {
		imsSecretID = cosSecretID
	}
	imsSecretKey := strings.TrimSpace(os.Getenv("IMS_SECRET_KEY"))
	if imsSecretKey == "" {
		imsSecretKey = cosSecretKey
	}
	imsRegion := strings.TrimSpace(os.Getenv("IMS_REGION"))
	imsBizType := strings.TrimSpace(os.Getenv("IMS_BIZ_TYPE"))
	imsAigcModerationType = strings.TrimSpace(os.Getenv("IMS_AIGC_MODERATION_TYPE"))
	if imsAigcModerationType == "" {
		imsAigcModerationType = "IMAGE_AIGC"
	}
	imsEnabled := !strings.EqualFold(strings.TrimSpace(os.Getenv("IMS_ENABLED")), "false")
	if imsSecretID == "" || imsSecretKey == "" {
		imsEnabled = false
	}
	gifModeration := service.ParseGifModerationConfig(
		os.Getenv("IMS_GIF_INTERVAL"),
		os.Getenv("IMS_GIF_MAX_FRAMES"),
	)
	imsClient, err := service.NewImageModerationClient(
		imsSecretID,
		imsSecretKey,
		imsRegion,
		imsBizType,
		imsEnabled,
		gifModeration,
	)
	if err != nil {
		log.Fatalf("init image moderation failed: %v", err)
	}
	if imsClient.Available() {
		log.Printf(
			"info: Tencent IMS image moderation enabled (aigcType=%s bizType=%s gifInterval=%d gifMaxFrames=%d)",
			imsAigcModerationType,
			imsBizType,
			gifModeration.Interval,
			gifModeration.MaxFrames,
		)
	} else {
		log.Printf("warn: IMS image moderation disabled or not configured")
	}
	vmSecretID := strings.TrimSpace(os.Getenv("VM_SECRET_ID"))
	if vmSecretID == "" {
		vmSecretID = imsSecretID
	}
	vmSecretKey := strings.TrimSpace(os.Getenv("VM_SECRET_KEY"))
	if vmSecretKey == "" {
		vmSecretKey = imsSecretKey
	}
	vmRegion := strings.TrimSpace(os.Getenv("VM_REGION"))
	if vmRegion == "" {
		vmRegion = imsRegion
	}
	vmBizType := strings.TrimSpace(os.Getenv("VM_BIZ_TYPE"))
	if vmBizType == "" {
		vmBizType = "video"
	}
	vmEnabled := !strings.EqualFold(strings.TrimSpace(os.Getenv("VM_ENABLED")), "false")
	if vmSecretID == "" || vmSecretKey == "" {
		vmEnabled = false
	}
	vmPollInterval, vmPollTimeout := service.ParseVideoModerationPollConfig(
		os.Getenv("VM_POLL_INTERVAL_SEC"),
		os.Getenv("VM_POLL_TIMEOUT_SEC"),
	)
	vmClient, err := service.NewVideoModerationClient(
		vmSecretID,
		vmSecretKey,
		vmRegion,
		vmBizType,
		vmEnabled,
		vmPollInterval,
		vmPollTimeout,
	)
	if err != nil {
		log.Fatalf("init video moderation failed: %v", err)
	}
	if vmClient.Available() {
		log.Printf(
			"info: Tencent VM video moderation enabled (bizType=%s pollInterval=%s pollTimeout=%s)",
			vmBizType,
			vmPollInterval,
			vmPollTimeout,
		)
	} else {
		log.Printf("warn: VM video moderation disabled or not configured")
	}

	resourceMapStore, err := newRuntimeResourceMap(resourceMapPath)
	if err != nil {
		log.Fatalf("load resource map failed: %v", err)
	}
	imageMapStore, err := newRuntimeResourceMap(imageMapPath)
	if err != nil {
		log.Fatalf("load image map failed: %v", err)
	}
	userDataRepo, err := service.NewUserDataRepo(service.UserDataPaths{
		LikesPath:             resourceLikesPath,
		FavoritesPath:         resourceFavoritesPath,
		BlockedUploadersPath:  blockedUploadersPath,
		FollowedUploadersPath: followedUploadersPath,
		DownloadsPath:         resourceDownloadsPath,
		MessagesPath:          messageBoardPath,
		ProfilesPath:          userProfilesPath,
		PromptPrefsPath:       userPromptPrefsPath,
		CreditsPath:           aiImageCreditsPath,
		SharesPath:            aiImageSharesPath,
		SharesUnlimitedPath:   aiImageSharesUnlimitedPath,
		LedgerPath:            aiCreditLedgerPath,
		LikeGrantsPath:        creditLikeGrantsPath,
		DailyRewardsPath:      creditDailyRewardsPath,
	})
	if err != nil {
		log.Fatalf("init user data storage failed: %v", err)
	}
	defer userDataRepo.Close()
	if userDataRepo.UsesMySQL() {
		log.Printf("info: user data storage backend=mysql")
		if strings.EqualFold(strings.TrimSpace(os.Getenv("MYSQL_IMPORT_JSON")), "1") {
			if err := userDataRepo.ImportJSONFiles(); err != nil {
				log.Fatalf("mysql import json failed: %v", err)
			}
			log.Printf("info: imported JSON files into MySQL")
		}
	} else {
		log.Printf("info: user data storage backend=json")
	}

	likes, err := userDataRepo.LoadLikes()
	if err != nil {
		log.Fatalf("load resource likes failed: %v", err)
	}
	favorites, err := userDataRepo.LoadFavorites()
	if err != nil {
		log.Fatalf("load resource favorites failed: %v", err)
	}
	if service.ReconcileFavoriteCounts(&favorites) {
		if saveErr := userDataRepo.SaveFavorites(favorites); saveErr != nil {
			log.Printf("warn: reconcile favorite counts save failed: %v", saveErr)
		} else {
			log.Printf("info: reconciled favorite counts from device favorites")
		}
	}
	downloads, err := userDataRepo.LoadDownloads()
	if err != nil {
		log.Fatalf("load resource downloads failed: %v", err)
	}
	messages, err := userDataRepo.LoadMessages()
	if err != nil {
		log.Fatalf("load message board failed: %v", err)
	}
	userProfiles, err := userDataRepo.LoadUserProfiles()
	if err != nil {
		log.Fatalf("load user profiles failed: %v", err)
	}
	userPromptPrefs, err := userDataRepo.LoadUserPromptPrefs()
	if err != nil {
		log.Fatalf("load user prompt prefs failed: %v", err)
	}
	aiShareQuota, err := userDataRepo.LoadAIShareQuota()
	if err != nil {
		log.Fatalf("load ai image share counts failed: %v", err)
	}
	aiShareUnlimited, err := userDataRepo.LoadAIShareUnlimited()
	if err != nil {
		log.Fatalf("load ai image share unlimited failed: %v", err)
	}
	aiCredits, err := userDataRepo.LoadAICredits()
	if err != nil {
		log.Fatalf("load ai image credits failed: %v", err)
	}
	creditLikeGrants, err := userDataRepo.LoadCreditLikeGrants()
	if err != nil {
		log.Fatalf("load credit like grants failed: %v", err)
	}
	creditDailyRewards, err := userDataRepo.LoadCreditDailyRewards()
	if err != nil {
		log.Fatalf("load credit daily rewards failed: %v", err)
	}
	shopCatalog, err := service.LoadShopCatalog(shopItemsPath)
	if err != nil {
		log.Fatalf("load shop items failed: %v", err)
	}
	reloadAICreditsLocked := func() {
		if err := userDataRepo.TryReloadAICredits(&aiCredits); err != nil {
			log.Printf("warn: reload ai credits failed: %v", err)
		}
	}
	reloadCreditRewardStoresLocked := func() {
		if latest, loadErr := userDataRepo.LoadCreditLikeGrants(); loadErr != nil {
			log.Printf("warn: reload credit like grants failed: %v", loadErr)
		} else {
			creditLikeGrants = latest
		}
		if latest, loadErr := userDataRepo.LoadCreditDailyRewards(); loadErr != nil {
			log.Printf("warn: reload credit daily rewards failed: %v", loadErr)
		} else {
			creditDailyRewards = latest
		}
	}
	reloadShareStoresLocked := func() {
		if err := userDataRepo.TryReloadAIShareQuota(&aiShareQuota); err != nil {
			log.Printf("warn: reload ai share quota failed: %v", err)
		}
		if err := userDataRepo.TryReloadAIShareUnlimited(&aiShareUnlimited); err != nil {
			log.Printf("warn: reload ai share unlimited failed: %v", err)
		}
	}
	imageReviewPath := os.Getenv("IMAGE_REVIEW_QUEUE_PATH")
	if imageReviewPath == "" {
		imageReviewPath = filepath.Join("config", "image_review_queue.json")
	}
	imageReviewStore, err := service.LoadImageReviewStore(imageReviewPath)
	if err != nil {
		log.Fatalf("load image review queue failed: %v", err)
	}
	gifUploadSessionStore := service.NewGifUploadSessionStore()
	videoUploadSessionStore := service.NewVideoUploadSessionStore()
	reviewAdminToken := strings.TrimSpace(os.Getenv("REVIEW_ADMIN_TOKEN"))

	signer, err := service.NewCOSSignerWithPrefix(
		cosBucket,
		cosRegion,
		cosSecretID,
		cosSecretKey,
		os.Getenv("RESOURCE_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init cos signer failed: %v", err)
	}
	imageSigner, err := service.NewCOSSignerWithPrefix(
		imageCOSBucket,
		imageCOSRegion,
		imageCOSSecretID,
		imageCOSSecretKey,
		os.Getenv("IMAGE_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init image cos signer failed: %v", err)
	}
	softwareSigner, err := service.NewCOSSignerWithPrefix(
		softwareCOSBucket,
		softwareCOSRegion,
		softwareCOSSecretID,
		softwareCOSSecretKey,
		os.Getenv("SOFTWARE_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init software cos signer failed: %v", err)
	}
	videoSigner, err := service.NewCOSSignerWithPrefix(
		videoCOSBucket,
		videoCOSRegion,
		videoCOSSecretID,
		videoCOSSecretKey,
		os.Getenv("VIDEO_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init video cos signer failed: %v", err)
	}
	gifSigner, err := service.NewCOSSignerWithPrefix(
		gifCOSBucket,
		gifCOSRegion,
		gifCOSSecretID,
		gifCOSSecretKey,
		os.Getenv("GIF_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init gif cos signer failed: %v", err)
	}
	videoCoverSigner, err := service.NewCOSSignerWithPrefix(
		videoCoverCOSBucket,
		videoCoverCOSRegion,
		videoCoverCOSSecretID,
		videoCoverCOSSecretKey,
		os.Getenv("VIDEO_COVER_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init video cover cos signer failed: %v", err)
	}
	gifCoverSigner, err := service.NewCOSSignerWithPrefix(
		gifCoverCOSBucket,
		gifCoverCOSRegion,
		gifCoverCOSSecretID,
		gifCoverCOSSecretKey,
		os.Getenv("GIF_COVER_COS_PREFIX"),
	)
	if err != nil {
		log.Fatalf("init gif cover cos signer failed: %v", err)
	}
	materialCDNBaseURL := strings.TrimSpace(os.Getenv("MATERIAL_CDN_BASE_URL"))
	materialCDNAuthKey := strings.TrimSpace(os.Getenv("MATERIAL_CDN_AUTH_KEY"))
	materialCDNSignParam := strings.TrimSpace(os.Getenv("MATERIAL_CDN_SIGN_PARAM"))
	for name, materialSigner := range map[string]*service.COSSigner{
		"resource":    signer,
		"image":       imageSigner,
		"software":    softwareSigner,
		"video":       videoSigner,
		"gif":         gifSigner,
		"video-cover": videoCoverSigner,
		"gif-cover":   gifCoverSigner,
	} {
		if err := materialSigner.ConfigureReadCDN(materialCDNBaseURL, materialCDNAuthKey, materialCDNSignParam); err != nil {
			log.Fatalf("configure %s CDN signer failed: %v", name, err)
		}
	}
	imageURLCache := map[string]signedURLCacheEntry{}
	var imageURLCacheMu sync.RWMutex
	var likesMu sync.RWMutex
	var favoritesMu sync.RWMutex
	var downloadsMu sync.Mutex
	var messagesMu sync.RWMutex
	var profilesMu sync.RWMutex
	var promptPrefsMu sync.RWMutex
	var aiShareMu sync.Mutex
	var aiCreditsMu sync.Mutex
	var imageReviewMu sync.RWMutex
	imageSignTTL := 10 * time.Minute

	activityRepo, err := service.NewActivityRepo(filepath.Join("config"))
	if err != nil {
		log.Fatalf("init activity repo failed: %v", err)
	}
	defer activityRepo.Close()
	activityService := service.NewActivityService(activityRepo, jwtSecret, func(sn string) bool {
		profilesMu.RLock()
		defer profilesMu.RUnlock()
		_, ok := userProfiles.Profiles[sn]
		return ok
	}, func(userSerial string) string {
		profilesMu.RLock()
		defer profilesMu.RUnlock()
		return service.ResolveStoredDisplayName(userProfiles, userSerial, "")
	})
	if err := activityService.EnsureDefaultActivity(); err != nil {
		log.Printf("warn: init default activity failed: %v", err)
	}
	activityCron := service.NewActivityCron(activityService)
	activityCron.Start()
	defer activityCron.Stop()

	mallRepo, err := service.NewMallRepo(filepath.Join("config"))
	if err != nil {
		log.Fatalf("init mall repo failed: %v", err)
	}
	defer mallRepo.Close()
	mallService := service.NewMallService(mallRepo, jwtSecret)
	if err := mallService.EnsureSeed(); err != nil {
		log.Printf("warn: init mall seed products failed: %v", err)
	}

	promoRepo, err := service.NewPromoRepo(filepath.Join("config"))
	if err != nil {
		log.Fatalf("init promo repo failed: %v", err)
	}
	defer promoRepo.Close()
	promoService := service.NewPromoService(promoRepo, jwtSecret)

	// 给缓存留 30 秒安全边界，避免返回临过期签名链接。
	imageCacheReuseTTL := imageSignTTL - 30*time.Second
	imagePublicBase := strings.TrimSpace(os.Getenv("IMAGE_COS_PUBLIC_BASE"))
	if imagePublicBase == "" && imageCOSBucket != "" && imageCOSRegion != "" {
		imagePublicBase = fmt.Sprintf("https://%s.cos.%s.myqcloud.com", imageCOSBucket, imageCOSRegion)
	}

	router := gin.Default()
	router.MaxMultipartMemory = 8 << 20
	router.Use(securityHeadersMiddleware())
	router.Use(corsMiddleware(corsAllowOrigin))
	router.Use(requestBodyLimitMiddleware())
	router.Use(adminRateLimitMiddleware(adminIPRateLimiter))
	router.Use(apiSignVerifier.Middleware())
	router.Use(abuseGuard.Middleware())

	requireDeviceFeatureAccess := func(c *gin.Context, serial string) bool {
		access, accessErr := activityService.GetDeviceFeatureAccess(serial)
		if accessErr != nil {
			log.Printf("warn: resolve device feature access failed: %v", accessErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "设备权限读取失败，请稍后重试"})
			return false
		}
		if !access.Enabled {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "请先到个人中心输入激活码，激活下载与传输功能"})
			return false
		}
		return true
	}

	router.POST("/api/auth", func(c *gin.Context) {
		clientIP := service.ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP"))
		if !authRateLimiter.Allow(clientIP) {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "认证请求过于频繁，请稍后再试"})
			return
		}

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
			abuseGuard.RecordInvalidToken(clientIP)
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "设备不匹配，请购买正规产品"})
			return
		}

		token := createToken(req.Serial, jwtSecret)
		if regErr := activityService.RegisterAuthenticatedDevice(req.Serial, "auth"); regErr != nil {
			log.Printf("warn: register device serial failed: %v", regErr)
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "token": token})
	})

	router.GET("/api/verify-token", func(c *gin.Context) {
		clientIP := ginClientIP(c)
		if abuseGuard.RejectRead(c, clientIP) {
			return
		}
		token := parseBearerToken(c)
		valid := verifyToken(token, jwtSecret, tokenTTL)
		if valid {
			c.JSON(http.StatusOK, gin.H{"success": true})
			return
		}
		abuseGuard.RecordInvalidToken(clientIP)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "token 无效或已过期，请重新验证设备"})
	})

	router.GET("/api/welcome", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		profilesMu.RLock()
		displayName := service.ResolveStoredDisplayName(userProfiles, serial, c.Query("displayName"))
		profilesMu.RUnlock()

		result := service.GenerateWelcome(
			c.Request.Context(),
			deepseekClient,
			serial,
			displayName,
			service.ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP")),
		)
		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"message":     result.Message,
			"username":    result.Username,
			"city":        result.City,
			"region":      result.Region,
			"localTime":   result.LocalTime,
			"temperature": result.Temperature,
			"weatherText": result.WeatherText,
		})
	})

	router.GET("/api/profile/display-name-check", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		requested := strings.TrimSpace(c.Query("displayName"))
		normalized := service.NormalizeDisplayName(serial, requested)
		defaultName := service.DisplayUsernameFromSerial(serial)
		available := normalized == defaultName

		if !available {
			profilesMu.RLock()
			available = !service.DisplayNameTakenByOther(userProfiles, serial, normalized)
			profilesMu.RUnlock()
		}

		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"available":   available,
			"displayName": normalized,
		})
	})

	router.GET("/api/profile", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		featureAccess, featureAccessErr := activityService.GetDeviceFeatureAccess(serial)
		if featureAccessErr != nil {
			log.Printf("warn: load device feature access failed: %v", featureAccessErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "设备权限读取失败，请稍后重试"})
			return
		}

		profilesMu.RLock()
		displayName := service.ResolveStoredDisplayName(userProfiles, serial, "")
		avatarObjectKey := userProfiles.Avatars[serial]
		profilesMu.RUnlock()
		avatarURL := ""
		if avatarObjectKey != "" {
			if signedAvatarURL, signErr := imageSigner.GenerateReadURL(c.Request.Context(), avatarObjectKey, 7*24*time.Hour); signErr != nil {
				log.Printf("warn: sign profile avatar failed for %s: %v", serial, signErr)
			} else {
				avatarURL = signedAvatarURL
			}
		}

		promptPrefsMu.RLock()
		softwarePromptDismissedID := service.GetSoftwarePromptDismissedID(userPromptPrefs, serial)
		promptPrefsMu.RUnlock()

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		credits := aiCredits.BalanceCredits(serial)
		aiCreditsMu.Unlock()

		creditLedgerEntries, ledgerErr := userDataRepo.ListCreditLedger(serial, 50)
		if ledgerErr != nil {
			log.Printf("warn: list credit ledger failed: %v", ledgerErr)
			creditLedgerEntries = []service.CreditLedgerEntry{}
		}
		creditLedger := service.ToCreditLedgerViews(creditLedgerEntries)

		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"success":                   true,
			"serial":                    serial,
			"displayName":               displayName,
			"avatarUrl":                 avatarURL,
			"credits":                   credits,
			"creditsDefault":            service.DefaultAICredits,
			"creditCost":                service.AICreditCostPerGeneration,
			"likeRewardCredits":         service.LikeCreditRewardAmount,
			"actorLikeRewardCredits":    service.UnitsToCredits(service.ActorLikeRewardUnits),
			"actorLikeDailyCapCredits":  service.UnitsToCredits(service.CreditDailyActorLikeCapUnits),
			"actorLikeDailyLimit":       service.CreditDailyActorLikeLimit,
			"downloadRewardCredits":     service.UnitsToCredits(service.DownloadRewardUnits),
			"downloadDailyCapCredits":   service.UnitsToCredits(service.CreditDailyDownloadCapUnits),
			"softwarePromptDismissedId": softwarePromptDismissedID,
			"downloadTransferEnabled":   featureAccess.Enabled,
			"featureGrandfathered":      featureAccess.Grandfathered,
			"deviceRegisteredAt":        featureAccess.RegisteredAt,
			"featureActivatedAt":        featureAccess.ActivatedAt,
			"creditLedger":              creditLedger,
		})
	})

	router.GET("/api/profile/feature-access", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		access, err := activityService.GetDeviceFeatureAccess(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "设备权限读取失败，请稍后重试"})
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"success": true, "access": access})
	})

	router.POST("/api/profile/feature-access/activate", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		var req deviceFeatureActivationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请输入激活码"})
			return
		}
		access, err := activityService.ActivateDeviceFeatures(serial, req.Code)
		if errors.Is(err, service.ErrInvalidDeviceFeatureActivationCode) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err != nil {
			log.Printf("warn: activate device features failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "激活失败，请稍后重试"})
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "激活成功，下载与传输功能已开启", "access": access})
	})

	router.POST("/api/profile/avatar/upload", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 800<<10)
		var req profileAvatarUploadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "头像请求格式无效或文件过大"})
			return
		}
		data, contentType, extension, err := service.DecodeProfileAvatar(req.ImageBase64, req.ContentType)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		objectKey := service.ProfileAvatarObjectKey(serial, extension, time.Now())
		if err := imageSigner.UploadObject(c.Request.Context(), objectKey, contentType, data); err != nil {
			log.Printf("warn: upload profile avatar failed for %s: %v", serial, err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "头像上传到存储失败，请稍后重试"})
			return
		}
		avatarURL, err := imageSigner.GenerateReadURL(c.Request.Context(), objectKey, 7*24*time.Hour)
		if err != nil {
			_ = imageSigner.DeleteObject(c.Request.Context(), objectKey)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "头像访问地址生成失败"})
			return
		}

		profilesMu.Lock()
		if userProfiles.Avatars == nil {
			userProfiles.Avatars = map[string]string{}
		}
		previousObjectKey := userProfiles.Avatars[serial]
		userProfiles.Avatars[serial] = objectKey
		if err := userDataRepo.SaveUserProfiles(userProfiles); err != nil {
			if previousObjectKey == "" {
				delete(userProfiles.Avatars, serial)
			} else {
				userProfiles.Avatars[serial] = previousObjectKey
			}
			profilesMu.Unlock()
			_ = imageSigner.DeleteObject(c.Request.Context(), objectKey)
			log.Printf("warn: save profile avatar failed for %s: %v", serial, err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "头像保存失败，请稍后重试"})
			return
		}
		profilesMu.Unlock()
		if previousObjectKey != "" && previousObjectKey != objectKey {
			if err := imageSigner.DeleteObject(c.Request.Context(), previousObjectKey); err != nil {
				log.Printf("warn: delete replaced profile avatar failed for %s: %v", serial, err)
			}
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"success": true, "avatarUrl": avatarURL})
	})

	router.DELETE("/api/profile/avatar", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		profilesMu.Lock()
		previousObjectKey := userProfiles.Avatars[serial]
		delete(userProfiles.Avatars, serial)
		if err := userDataRepo.SaveUserProfiles(userProfiles); err != nil {
			if previousObjectKey != "" {
				userProfiles.Avatars[serial] = previousObjectKey
			}
			profilesMu.Unlock()
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "头像删除失败，请稍后重试"})
			return
		}
		profilesMu.Unlock()
		if previousObjectKey != "" {
			if err := imageSigner.DeleteObject(c.Request.Context(), previousObjectKey); err != nil {
				log.Printf("warn: delete profile avatar object failed for %s: %v", serial, err)
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "avatarUrl": ""})
	})

	router.GET("/api/creator-profile", func(c *gin.Context) {
		token := parseBearerToken(c)
		if _, ok := serialFromToken(token, jwtSecret, tokenTTL); !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		requestedName := strings.TrimSpace(c.Query("displayName"))
		if requestedName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "displayName 不能为空"})
			return
		}
		profilesMu.RLock()
		creatorSerial := service.FindProfileSerialByDisplayName(userProfiles, requestedName)
		avatarObjectKey := userProfiles.Avatars[creatorSerial]
		resolvedName := requestedName
		if creatorSerial != "" {
			resolvedName = service.ResolveStoredDisplayName(userProfiles, creatorSerial, "")
		}
		profilesMu.RUnlock()
		avatarURL := ""
		if avatarObjectKey != "" {
			if signedAvatarURL, err := imageSigner.GenerateReadURL(c.Request.Context(), avatarObjectKey, 7*24*time.Hour); err == nil {
				avatarURL = signedAvatarURL
			} else {
				log.Printf("warn: sign creator avatar failed: %v", err)
			}
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"success": true, "displayName": resolvedName, "avatarUrl": avatarURL})
	})

	router.GET("/api/leaderboard/credits", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		creditsSnapshot := service.AICreditsStore{
			UnitScale: aiCredits.UnitScale,
			Balances:  make(map[string]int, len(aiCredits.Balances)),
		}
		for userSerial, balance := range aiCredits.Balances {
			creditsSnapshot.Balances[userSerial] = balance
		}
		aiCreditsMu.Unlock()

		profilesMu.RLock()
		profilesSnapshot := service.UserProfilesStore{
			Profiles: make(map[string]string, len(userProfiles.Profiles)),
			Avatars:  make(map[string]string, len(userProfiles.Avatars)),
		}
		for userSerial, displayName := range userProfiles.Profiles {
			profilesSnapshot.Profiles[userSerial] = displayName
		}
		for userSerial, avatarKey := range userProfiles.Avatars {
			profilesSnapshot.Avatars[userSerial] = avatarKey
		}
		profilesMu.RUnlock()

		catalogItems, catalogErr := loadResourceCatalog(resourcesPath)
		if catalogErr != nil {
			log.Printf("warn: load catalog creator names for leaderboard failed: %v", catalogErr)
			catalogItems = []map[string]any{}
		}
		creatorNames := service.PrimaryCatalogAuthorsByUploaderSerial(catalogItems)
		result := service.BuildCreditLeaderboard(creditsSnapshot, profilesSnapshot, creatorNames, serial, 50)
		toView := func(entry service.CreditLeaderboardEntry) gin.H {
			avatarURL := ""
			if entry.AvatarKey != "" {
				if signedURL, signErr := imageSigner.GenerateReadURL(c.Request.Context(), entry.AvatarKey, imageSignTTL); signErr == nil {
					avatarURL = signedURL
				} else {
					log.Printf("warn: sign leaderboard avatar failed: %v", signErr)
				}
			}
			return gin.H{
				"rank":        entry.Rank,
				"displayName": entry.DisplayName,
				"creatorName": entry.CreatorName,
				"credits":     entry.Credits,
				"avatarUrl":   avatarURL,
				"isCurrent":   entry.IsCurrent,
			}
		}
		entries := make([]gin.H, 0, len(result.Entries))
		for _, entry := range result.Entries {
			entries = append(entries, toView(entry))
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"success":    true,
			"entries":    entries,
			"current":    toView(result.Current),
			"totalUsers": result.TotalUsers,
			"updatedAt":  time.Now().UTC().Format(time.RFC3339),
		})
	})

	router.POST("/api/profile/software-prompt/dismiss", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req softwarePromptDismissRequest
		if err := c.ShouldBindJSON(&req); err != nil || req.ResourceID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 无效"})
			return
		}

		promptPrefsMu.Lock()
		dismissedID := service.SetSoftwarePromptDismissedID(&userPromptPrefs, serial, req.ResourceID)
		saveErr := userDataRepo.SaveUserPromptPrefs(userPromptPrefs)
		promptPrefsMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":                   true,
			"softwarePromptDismissedId": dismissedID,
		})
	})

	router.GET("/api/profile/uploads", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		items, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}

		published := service.FilterCatalogByUploaderSerial(items, serial)
		service.SortCatalogByUpdatedAtDesc(published)
		published = service.SanitizePublicResourceCatalog(published)

		imageReviewMu.RLock()
		reviews := service.ListDeviceUploadReviews(&imageReviewStore, serial)
		service.AttachReviewPreviewURLs(
			c.Request.Context(),
			reviews,
			&imageReviewStore,
			serial,
			service.ReviewPreviewSigners{
				Image:      imageSigner,
				GifCover:   gifCoverSigner,
				VideoCover: videoCoverSigner,
			},
		)
		imageReviewMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":   true,
			"published": published,
			"reviews":   reviews,
		})
	})

	router.POST("/api/profile/uploads/title", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req profileUploadTitleRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		title, titleErr := service.ValidateUploadTitle(req.Title)
		if titleErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": titleErr.Error()})
			return
		}

		kind := strings.TrimSpace(strings.ToLower(req.Kind))
		switch kind {
		case "published":
			resourceID, parseErr := strconv.ParseInt(strings.TrimSpace(req.ResourceID), 10, 64)
			if parseErr != nil || resourceID <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "素材编号无效"})
				return
			}
			if err := service.UpdateOwnPublishedUploadTitle(serial, resourceID, title, resourcesPath); err != nil {
				status := http.StatusBadRequest
				if strings.Contains(err.Error(), "不存在") {
					status = http.StatusNotFound
				} else if strings.Contains(err.Error(), "无权") {
					status = http.StatusForbidden
				}
				c.JSON(status, gin.H{"success": false, "message": err.Error()})
				return
			}
		case "review":
			reviewID := strings.TrimSpace(req.ReviewID)
			if reviewID == "" {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "复核编号无效"})
				return
			}
			imageReviewMu.Lock()
			updateErr := service.UpdateOwnReviewUploadTitle(&imageReviewStore, reviewID, serial, title)
			if updateErr == nil {
				updateErr = service.SaveImageReviewStore(imageReviewPath, imageReviewStore)
			}
			imageReviewMu.Unlock()
			if updateErr != nil {
				status := http.StatusBadRequest
				if strings.Contains(updateErr.Error(), "不存在") {
					status = http.StatusNotFound
				} else if strings.Contains(updateErr.Error(), "无权") {
					status = http.StatusForbidden
				}
				c.JSON(status, gin.H{"success": false, "message": updateErr.Error()})
				return
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "素材类型无效"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "标题已修改",
			"kind":    kind,
			"title":   title,
		})
	})

	deleteSigners := service.UploadDeleteSigners{
		Image:      imageSigner,
		Gif:        gifSigner,
		Video:      videoSigner,
		GifCover:   gifCoverSigner,
		VideoCover: videoCoverSigner,
	}
	cleanupDeletedResource := func(resourceID string) []string {
		resourceID = strings.TrimSpace(resourceID)
		if resourceID == "" {
			return nil
		}
		warnings := make([]string, 0)
		resourceMapStore.remove(resourceID)
		imageMapStore.remove(resourceID)
		imageURLCacheMu.Lock()
		clear(imageURLCache)
		imageURLCacheMu.Unlock()

		favoritesMu.Lock()
		service.RemoveResourceFromAllFavorites(&favorites, resourceID)
		if err := userDataRepo.SaveFavorites(favorites); err != nil {
			warnings = append(warnings, "收藏记录清理失败")
			log.Printf("warn: favorites cleanup after resource delete failed: %v", err)
		}
		favoritesMu.Unlock()

		likesMu.Lock()
		service.RemoveResourceFromAllLikes(&likes, resourceID)
		if err := userDataRepo.SaveLikes(likes); err != nil {
			warnings = append(warnings, "点赞记录清理失败")
			log.Printf("warn: likes cleanup after resource delete failed: %v", err)
		}
		likesMu.Unlock()

		downloadsMu.Lock()
		service.RemoveResourceFromDownloads(&downloads, resourceID)
		if err := userDataRepo.SaveDownloads(downloads); err != nil {
			warnings = append(warnings, "下载统计清理失败")
			log.Printf("warn: downloads cleanup after resource delete failed: %v", err)
		}
		downloadsMu.Unlock()

		messagesMu.Lock()
		service.RemoveResourceMessages(&messages, resourceID)
		if err := userDataRepo.SaveMessages(messages); err != nil {
			warnings = append(warnings, "评论清理失败")
			log.Printf("warn: messages cleanup after resource delete failed: %v", err)
		}
		messagesMu.Unlock()

		aiCreditsMu.Lock()
		reloadCreditRewardStoresLocked()
		creditLikeGrants.RemoveResource(resourceID)
		if err := userDataRepo.SaveCreditLikeGrants(creditLikeGrants); err != nil {
			warnings = append(warnings, "点赞积分授权清理失败")
			log.Printf("warn: credit like grants cleanup after resource delete failed: %v", err)
		}
		aiCreditsMu.Unlock()

		if err := userDataRepo.DeleteResourceInteractions(resourceID); err != nil {
			warnings = append(warnings, "推荐行为记录清理失败")
			log.Printf("warn: resource interactions cleanup after resource delete failed: %v", err)
		}
		return warnings
	}

	router.POST("/api/profile/uploads/delete", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req profileUploadDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		kind := strings.TrimSpace(strings.ToLower(req.Kind))
		switch kind {
		case "published":
			resourceID, parseErr := strconv.ParseInt(strings.TrimSpace(req.ResourceID), 10, 64)
			if parseErr != nil || resourceID <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "素材编号无效"})
				return
			}

			deletedEntry, deletedResourceMap, deletedImageMap, idKey, hasSnapshot := service.LoadPublishedUploadSnapshot(
				resourcesPath,
				resourceMapPath,
				imageMapPath,
				resourceID,
			)

			if err := service.DeleteOwnPublishedUpload(c.Request.Context(), service.DeleteOwnPublishedUploadInput{
				Serial:          serial,
				ResourceID:      resourceID,
				ResourcesPath:   resourcesPath,
				ResourceMapPath: resourceMapPath,
				ImageMapPath:    imageMapPath,
				Signers:         deleteSigners,
			}); err != nil {
				status := http.StatusBadRequest
				if strings.Contains(err.Error(), "不存在") {
					status = http.StatusNotFound
				} else if strings.Contains(err.Error(), "无权") {
					status = http.StatusForbidden
				} else if strings.Contains(err.Error(), "COS") {
					status = http.StatusBadGateway
				}
				c.JSON(status, gin.H{"success": false, "message": err.Error()})
				return
			}

			cleanupWarnings := make([]string, 0)
			if hasSnapshot {
				imageReviewMu.Lock()
				service.RemoveReviewEntriesForPublishedResource(
					&imageReviewStore,
					serial,
					deletedEntry,
					deletedResourceMap,
					deletedImageMap,
					idKey,
				)
				if saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore); saveErr != nil {
					log.Printf("warn: cleanup review entries after published delete failed: %v", saveErr)
					cleanupWarnings = append(cleanupWarnings, "审核记录清理失败")
				}
				imageReviewMu.Unlock()
			}
			cleanupWarnings = append(cleanupWarnings, cleanupDeletedResource(idKey)...)

			c.JSON(http.StatusOK, gin.H{
				"success":         true,
				"message":         "素材已删除",
				"kind":            kind,
				"resourceId":      resourceID,
				"cleanupComplete": len(cleanupWarnings) == 0,
				"cleanupWarnings": cleanupWarnings,
			})
		case "review":
			reviewID := strings.TrimSpace(req.ReviewID)
			if reviewID == "" {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "复核编号无效"})
				return
			}
			imageReviewMu.Lock()
			deleteResult, deleteErr := service.DeleteOwnReviewUpload(c.Request.Context(), service.DeleteOwnReviewUploadInput{
				Store:           &imageReviewStore,
				ReviewID:        reviewID,
				Serial:          serial,
				Signers:         deleteSigners,
				ResourcesPath:   resourcesPath,
				ResourceMapPath: resourceMapPath,
				ImageMapPath:    imageMapPath,
			})
			if deleteErr != nil {
				imageReviewMu.Unlock()
				status := http.StatusBadRequest
				if strings.Contains(deleteErr.Error(), "不存在") {
					status = http.StatusNotFound
				} else if strings.Contains(deleteErr.Error(), "无权") {
					status = http.StatusForbidden
				} else if strings.Contains(deleteErr.Error(), "COS") {
					status = http.StatusBadGateway
				}
				c.JSON(status, gin.H{"success": false, "message": deleteErr.Error()})
				return
			}
			if saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore); saveErr != nil {
				imageReviewMu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "复核队列保存失败"})
				return
			}
			imageReviewMu.Unlock()

			if deleteResult.DeletedResourceID > 0 {
				idKey := strconv.FormatInt(deleteResult.DeletedResourceID, 10)
				cleanupWarnings := cleanupDeletedResource(idKey)
				if len(cleanupWarnings) > 0 {
					log.Printf("warn: review delete cleanup incomplete: %s", strings.Join(cleanupWarnings, ", "))
				}
				c.JSON(http.StatusOK, gin.H{
					"success":         true,
					"message":         "上传记录及已发布素材已删除",
					"kind":            kind,
					"reviewId":        reviewID,
					"resourceId":      deleteResult.DeletedResourceID,
					"cleanupComplete": len(cleanupWarnings) == 0,
					"cleanupWarnings": cleanupWarnings,
				})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"success":  true,
				"message":  "上传记录已删除",
				"kind":     kind,
				"reviewId": reviewID,
			})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "kind 无效"})
		}
	})

	router.DELETE("/api/admin/resources/:id", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		resourceID, parseErr := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
		if parseErr != nil || resourceID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "素材编号无效"})
			return
		}

		deletedEntry, deletedResourceMap, deletedImageMap, idKey, hasSnapshot := service.LoadPublishedUploadSnapshot(
			resourcesPath,
			resourceMapPath,
			imageMapPath,
			resourceID,
		)
		if err := service.DeleteOwnPublishedUpload(c.Request.Context(), service.DeleteOwnPublishedUploadInput{
			ResourceID:      resourceID,
			ResourcesPath:   resourcesPath,
			ResourceMapPath: resourceMapPath,
			ImageMapPath:    imageMapPath,
			Signers:         deleteSigners,
			AllowAnyOwner:   true,
		}); err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "不存在") {
				status = http.StatusNotFound
			} else if strings.Contains(err.Error(), "COS") {
				status = http.StatusBadGateway
			}
			c.JSON(status, gin.H{"success": false, "message": err.Error()})
			return
		}

		cleanupWarnings := make([]string, 0)
		if hasSnapshot {
			if uploaderSerial := service.PublishedUploadUploaderSerial(deletedEntry); uploaderSerial != "" {
				imageReviewMu.Lock()
				service.RemoveReviewEntriesForPublishedResource(
					&imageReviewStore,
					uploaderSerial,
					deletedEntry,
					deletedResourceMap,
					deletedImageMap,
					idKey,
				)
				if saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore); saveErr != nil {
					log.Printf("warn: admin cleanup review entries after resource delete failed: %v", saveErr)
					cleanupWarnings = append(cleanupWarnings, "审核记录清理失败")
				}
				imageReviewMu.Unlock()
			}
		}
		cleanupWarnings = append(cleanupWarnings, cleanupDeletedResource(idKey)...)

		c.JSON(http.StatusOK, gin.H{
			"success":         true,
			"message":         "管理员已永久删除素材",
			"resourceId":      resourceID,
			"cleanupComplete": len(cleanupWarnings) == 0,
			"cleanupWarnings": cleanupWarnings,
		})
	})

	router.GET("/api/shop/items", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		balance := aiCredits.BalanceCredits(serial)
		aiCreditsMu.Unlock()
		creditLedgerEntries, ledgerErr := userDataRepo.ListCreditLedger(serial, 50)
		if ledgerErr != nil {
			log.Printf("warn: list credit ledger failed: %v", ledgerErr)
			creditLedgerEntries = []service.CreditLedgerEntry{}
		}
		creditLedger := service.ToCreditLedgerViews(creditLedgerEntries)
		publicItems := shopCatalog.PublicItems()
		for i := range publicItems {
			if publicItems[i].Effect.Type != service.ShopEffectPhysical {
				continue
			}
			stock := 0
			if current, stockErr := mallService.PointRedemptionStock(publicItems[i].Effect.ProductID); stockErr == nil {
				stock = current
			}
			publicItems[i].Stock = &stock
		}
		c.JSON(http.StatusOK, gin.H{
			"success":                  true,
			"credits":                  balance,
			"likeRewardCredits":        service.LikeCreditRewardAmount,
			"actorLikeRewardCredits":   service.UnitsToCredits(service.ActorLikeRewardUnits),
			"actorLikeDailyCapCredits": service.UnitsToCredits(service.CreditDailyActorLikeCapUnits),
			"actorLikeDailyLimit":      service.CreditDailyActorLikeLimit,
			"downloadRewardCredits":    service.UnitsToCredits(service.DownloadRewardUnits),
			"downloadDailyCapCredits":  service.UnitsToCredits(service.CreditDailyDownloadCapUnits),
			"items":                    publicItems,
			"creditLedger":             creditLedger,
		})
	})

	router.POST("/api/shop/redeem", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		var req shopRedeemRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ItemID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "itemId 不能为空"})
			return
		}

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		aiShareMu.Lock()
		reloadShareStoresLocked()
		shareQuotaBeforeRedeem := aiShareQuota.Clone()
		result, redeemErr := service.RedeemShopItem(
			service.ShopRedeemInput{
				Serial: serial,
				ItemID: req.ItemID,
				Shipping: service.MallShippingPlain{
					Name: req.Name, Phone: req.Phone, Wechat: req.Wechat, QQ: req.QQ,
					Province: req.Province, City: req.City, Address: req.Address,
				},
				Remark: req.Remark,
			},
			shopCatalog,
			&aiCredits,
			&aiShareQuota,
			mallService,
		)
		if redeemErr != nil {
			balance := aiCredits.BalanceCredits(serial)
			aiShareMu.Unlock()
			aiCreditsMu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": redeemErr.Error(),
				"credits": balance,
			})
			return
		}
		if saveErr := userDataRepo.SaveAICredits(aiCredits); saveErr != nil {
			if result.OrderID != "" {
				if rollbackErr := mallService.RollbackPointRedemptionOrder(result.OrderID); rollbackErr != nil {
					log.Printf("error: rollback point redemption order %s failed: %v", result.OrderID, rollbackErr)
				}
			}
			aiCredits.RefundUnits(serial, service.CreditsToUnits(result.Cost))
			aiShareQuota = shareQuotaBeforeRedeem
			aiShareMu.Unlock()
			aiCreditsMu.Unlock()
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "积分保存失败"})
			return
		}
		if item, found := shopCatalog.FindItem(strings.TrimSpace(req.ItemID)); found && item.Effect.Type == service.ShopEffectResetAIShare {
			if saveShareErr := userDataRepo.SaveAIShareQuota(aiShareQuota); saveShareErr != nil {
				aiShareQuota = shareQuotaBeforeRedeem
				aiCredits.RefundUnits(serial, service.CreditsToUnits(result.Cost))
				if refundErr := userDataRepo.SaveAICredits(aiCredits); refundErr != nil {
					log.Printf("error: refund credits after share quota save failed: %v", refundErr)
				}
				aiShareMu.Unlock()
				aiCreditsMu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "上传额度保存失败，积分已退回"})
				return
			}
		}
		aiShareMu.Unlock()
		aiCreditsMu.Unlock()

		if ledgerErr := userDataRepo.RecordCreditChange(
			serial,
			-service.CreditsToUnits(result.Cost),
			service.CreditSourceShopRedeem,
			fmt.Sprintf("兑换「%s」", result.Title),
			result.ItemID,
		); ledgerErr != nil {
			log.Printf("warn: record shop redeem ledger failed: %v", ledgerErr)
		}
		if result.RewardCredits > 0 {
			if ledgerErr := userDataRepo.RecordCreditChange(
				serial,
				service.CreditsToUnits(result.RewardCredits),
				service.CreditSourceShopBonus,
				fmt.Sprintf("兑换「%s」奖励", result.Title),
				result.ItemID,
			); ledgerErr != nil {
				log.Printf("warn: record shop bonus ledger failed: %v", ledgerErr)
			}
		}

		resp := gin.H{
			"success":          true,
			"message":          result.Message,
			"itemId":           result.ItemID,
			"title":            result.Title,
			"cost":             result.Cost,
			"creditsRemaining": result.CreditsRemaining,
			"rewardCredits":    result.RewardCredits,
			"redeemCode":       result.RedeemCode,
			"shareCount":       result.ShareCount,
			"shareLimit":       result.ShareLimit,
			"orderId":          result.OrderID,
			"orderStatus":      result.OrderStatus,
		}
		if aiShareUnlimited.Has(serial) {
			resp["shareUnlimited"] = true
		} else {
			resp["shareRemaining"] = result.ShareRemaining
		}
		c.JSON(http.StatusOK, resp)
	})

	router.POST("/api/profile", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req profilePostRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		profilesMu.Lock()
		displayName, setErr := service.SetStoredDisplayName(&userProfiles, serial, req.DisplayName)
		if setErr != nil {
			profilesMu.Unlock()
			if errors.Is(setErr, service.ErrDisplayNameTaken) {
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "该昵称已被使用，请换一个"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "昵称保存失败"})
			return
		}
		saveErr := userDataRepo.SaveUserProfiles(userProfiles)
		profilesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "昵称保存失败"})
			return
		}

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		credits := aiCredits.BalanceCredits(serial)
		aiCreditsMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"serial":         serial,
			"displayName":    displayName,
			"credits":        credits,
			"creditsDefault": service.DefaultAICredits,
			"creditCost":     service.AICreditCostPerGeneration,
		})
	})

	router.GET("/api/resources", func(c *gin.Context) {
		if abuseGuard.RejectRead(c, ginClientIP(c)) {
			return
		}
		items, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "load resources failed"})
			return
		}
		c.Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
		c.JSON(http.StatusOK, service.SanitizePublicResourceCatalog(items))
	})

	recordResourceInteraction := func(serial, resourceID, action string, now time.Time) {
		if err := userDataRepo.RecordResourceInteraction(serial, resourceID, action, now); err != nil {
			log.Printf("warn: record resource interaction failed: %v", err)
		}
	}

	router.GET("/api/recommendations", func(c *gin.Context) {
		clientIP := ginClientIP(c)
		serial, ok := serialFromToken(parseBearerToken(c), jwtSecret, tokenTTL)
		if !ok {
			abuseGuard.RecordInvalidToken(clientIP)
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if abuseGuard.RejectRead(c, clientIP) {
			return
		}
		limit := 8
		if parsed, err := strconv.Atoi(strings.TrimSpace(c.Query("limit"))); err == nil && parsed > 0 {
			limit = parsed
		}
		if limit > 64 {
			limit = 64
		}
		catalog, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		serial = service.NormalizeLikeSerial(serial)
		interactions, err := userDataRepo.ListResourceInteractions(serial, 200)
		if err != nil {
			log.Printf("warn: load recommendation interactions failed: %v", err)
			interactions = []service.ResourceInteraction{}
		}

		likesMu.RLock()
		deviceLikes := make(map[string]bool, len(likes.DeviceLikes[serial]))
		for id, liked := range likes.DeviceLikes[serial] {
			deviceLikes[id] = liked
		}
		likeCounts := make(map[string]int, len(likes.Counts))
		for id, count := range likes.Counts {
			likeCounts[id] = count
		}
		likesMu.RUnlock()

		favoritesMu.RLock()
		deviceFavorites := make(map[string]int64, len(favorites.DeviceFavorites[serial]))
		for id, createdAt := range favorites.DeviceFavorites[serial] {
			deviceFavorites[id] = createdAt
		}
		favoriteCounts := make(map[string]int, len(favorites.Counts))
		for id, count := range favorites.Counts {
			favoriteCounts[id] = count
		}
		favoritesMu.RUnlock()

		downloadsMu.Lock()
		downloads.EnsureCurrentWeek(time.Now())
		totalDownloads := make(map[string]int, len(downloads.TotalCounts))
		for id, count := range downloads.TotalCounts {
			totalDownloads[id] = count
		}
		weeklyDownloads := make(map[string]int, len(downloads.WeeklyCounts))
		for id, count := range downloads.WeeklyCounts {
			weeklyDownloads[id] = count
		}
		downloadsMu.Unlock()

		poolLimit := limit * 3
		if poolLimit < 96 {
			poolLimit = 96
		}
		mode, recommendationPool := service.BuildResourceRecommendations(catalog, service.RecommendationSignals{
			Liked:           deviceLikes,
			Favorites:       deviceFavorites,
			Interactions:    interactions,
			LikeCounts:      likeCounts,
			FavoriteCounts:  favoriteCounts,
			TotalDownloads:  totalDownloads,
			WeeklyDownloads: weeklyDownloads,
		}, poolLimit, time.Now())
		excludedIDs := make(map[string]bool)
		for _, id := range strings.Split(c.Query("exclude"), ",") {
			id = strings.TrimSpace(id)
			if id != "" && len(excludedIDs) < 96 {
				excludedIDs[id] = true
			}
		}
		seed := strings.TrimSpace(c.Query("seed"))
		if len(seed) > 96 {
			seed = seed[:96]
		}
		if seed == "" {
			seed = fmt.Sprintf("%s-%d", serial, time.Now().UnixNano())
		}
		recommendations := service.RotateResourceRecommendations(recommendationPool, limit, seed, excludedIDs)
		recommendedIDs := make([]string, 0, len(recommendations))
		for _, recommendation := range recommendations {
			recommendedIDs = append(recommendedIDs, recommendation.ResourceID)
		}
		recommendedResources := service.SelectPublicResourceCatalog(catalog, recommendedIDs)
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"success":   true,
			"mode":      mode,
			"items":     recommendations,
			"resources": recommendedResources,
		})
	})

	router.POST("/api/resource-interaction", func(c *gin.Context) {
		clientIP := ginClientIP(c)
		serial, ok := serialFromToken(parseBearerToken(c), jwtSecret, tokenTTL)
		if !ok {
			abuseGuard.RecordInvalidToken(clientIP)
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if abuseGuard.RejectRead(c, clientIP) {
			return
		}
		var req resourceInteractionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)
		action := strings.ToLower(strings.TrimSpace(req.Action))
		if resourceID == "" || (action != service.ResourceInteractionView && action != service.ResourceInteractionTransfer) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "行为参数无效"})
			return
		}
		_, resourceExists := resourceMapStore.get(resourceID)
		_, imageExists := imageMapStore.get(resourceID)
		if !resourceExists && !imageExists {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "素材不存在"})
			return
		}
		if err := userDataRepo.RecordResourceInteraction(serial, resourceID, action, time.Now()); err != nil {
			log.Printf("record resource interaction failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "行为记录失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	router.GET("/api/column-tags", func(c *gin.Context) {
		if abuseGuard.RejectRead(c, ginClientIP(c)) {
			return
		}
		items, err := loadColumnTags(columnTagsPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "load column tags failed"})
			return
		}
		c.JSON(http.StatusOK, items)
	})

	router.POST("/api/ai-guide", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, aiTokenRateLimiter, aiIPRateLimiter, serial, "AI 助手请求过于频繁，请稍后再试") {
			return
		}

		var req aiGuideRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		question := strings.TrimSpace(req.Question)
		if question == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "question 不能为空"})
			return
		}

		rawResources, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		rawTags, err := loadColumnTags(columnTagsPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "专栏标签加载失败"})
			return
		}

		catalog := service.BuildAIGuideCatalog(rawResources, question)
		columnSummary := service.BuildColumnTagSummary(rawTags)

		mode := "fallback"
		var result *service.AIGuideResult
		if deepseekClient.APIKey != "" {
			result, err = deepseekClient.GenerateGuide(c.Request.Context(), question, catalog, columnSummary)
			if err != nil {
				log.Printf("warn: deepseek ai guide failed: %v", err)
				result = service.LocalAIGuideFallback(question, catalog)
			} else {
				mode = "deepseek"
			}
		} else {
			result = service.LocalAIGuideFallback(question, catalog)
		}

		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"answer":      result.Answer,
			"resourceIds": result.ResourceIDs,
			"mode":        mode,
		})
	})

	router.POST("/api/ai-image", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, aiTokenRateLimiter, aiIPRateLimiter, serial, "AI 图片请求过于频繁，请稍后再试") {
			return
		}
		if minimaxClient.APIKey == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "AI 图片生成服务未配置"})
			return
		}

		var req aiImageRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		remainingUnits, spendErr := aiCredits.SpendUnits(serial, service.AICreditCostPerGenerationUnits)
		creditsRemaining := service.UnitsToCredits(remainingUnits)
		if spendErr != nil {
			balance := aiCredits.BalanceCredits(serial)
			aiCreditsMu.Unlock()
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success":    false,
				"message":    spendErr.Error(),
				"credits":    balance,
				"creditCost": service.AICreditCostPerGeneration,
			})
			return
		}
		if saveErr := userDataRepo.SaveAICredits(aiCredits); saveErr != nil {
			aiCredits.RefundUnits(serial, service.AICreditCostPerGenerationUnits)
			aiCreditsMu.Unlock()
			log.Printf("warn: save ai image credits failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "积分扣减失败，请稍后重试"})
			return
		}
		aiCreditsMu.Unlock()

		if ledgerErr := userDataRepo.RecordCreditChange(
			serial,
			-service.AICreditCostPerGenerationUnits,
			service.CreditSourceAIGenerate,
			"",
			"",
		); ledgerErr != nil {
			log.Printf("warn: record ai generate ledger failed: %v", ledgerErr)
		}

		result, err := minimaxClient.GenerateImages(
			c.Request.Context(),
			req.Prompt,
			req.AspectRatio,
			req.Count,
		)
		if err != nil {
			aiCreditsMu.Lock()
			reloadAICreditsLocked()
			creditsRemaining = service.UnitsToCredits(aiCredits.RefundUnits(serial, service.AICreditCostPerGenerationUnits))
			if refundErr := userDataRepo.SaveAICredits(aiCredits); refundErr != nil {
				log.Printf("warn: refund ai image credits failed: %v", refundErr)
			}
			aiCreditsMu.Unlock()
			if ledgerErr := userDataRepo.RecordCreditChange(
				serial,
				service.AICreditCostPerGenerationUnits,
				service.CreditSourceAIRefund,
				"",
				"",
			); ledgerErr != nil {
				log.Printf("warn: record ai refund ledger failed: %v", ledgerErr)
			}
			log.Printf("warn: minimax image generation failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{
				"success":          false,
				"message":          err.Error(),
				"creditsRemaining": creditsRemaining,
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":          true,
			"images":           result.Images,
			"mode":             "minimax",
			"creditsRemaining": creditsRemaining,
		})
	})

	router.POST("/api/ai-image/transfer", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if !requireDeviceFeatureAccess(c, serial) {
			return
		}
		if rateLimitRejected(c, aiTokenRateLimiter, aiIPRateLimiter, serial, "AI 图片请求过于频繁，请稍后再试") {
			return
		}

		var req aiImageTransferRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		profilesMu.RLock()
		author := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		if !isAIGeneratedSource(req.Source) {
			imageReviewMu.Lock()
			reviewItem, pending, modErr := service.ProcessImageModerationWithReview(
				c.Request.Context(),
				imsClient,
				imageSigner,
				&imageReviewStore,
				service.EnqueueImageReviewInput{
					Serial:      serial,
					Author:      author,
					Action:      service.ReviewActionTransfer,
					ImageBase64: req.ImageBase64,
					Source:      req.Source,
				},
				serial+"-transfer",
				imsModerationType(req.Source, "IMAGE"),
			)
			if pending {
				saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore)
				imageReviewMu.Unlock()
				if saveErr != nil {
					log.Printf("warn: save image review queue failed: %v", saveErr)
				}
				writeImageReviewPending(c, reviewItem)
				return
			}
			imageReviewMu.Unlock()
			if modErr != nil {
				writeImageModerationError(c, modErr)
				return
			}
		}

		signedURL, err := service.StageAIImageForTransfer(
			c.Request.Context(),
			imageSigner,
			serial,
			req.ImageBase64,
			req.FileName,
			imageSignTTL,
		)
		if err != nil {
			log.Printf("warn: ai image transfer staging failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"url":     signedURL,
		})
	})

	router.POST("/api/ai-image/share", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, aiTokenRateLimiter, aiIPRateLimiter, serial, "AI 图片请求过于频繁，请稍后再试") {
			return
		}

		var req aiImageShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		if limitMsg := service.ShareLimitMessageWithUnlimited(aiShareQuota, aiShareUnlimited, serial, service.MaxAISharesPerDevice); limitMsg != "" {
			quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
			aiShareMu.Unlock()
			resp := gin.H{
				"success": false,
				"message": limitMsg,
			}
			for key, value := range quotaFields {
				resp[key] = value
			}
			c.JSON(http.StatusTooManyRequests, resp)
			return
		}
		aiShareMu.Unlock()

		profilesMu.RLock()
		author := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		result, err := service.ShareAIImageToCatalog(
			c.Request.Context(),
			imageSigner,
			imagePublicBase,
			resourcesPath,
			imageMapPath,
			service.ShareAIImageInput{
				ImageBase64:    req.ImageBase64,
				Prompt:         req.Prompt,
				Title:          req.Title,
				Author:         author,
				UploaderSerial: serial,
			},
		)
		if err != nil {
			log.Printf("warn: ai image share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save ai image share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		resp := gin.H{
			"success":     true,
			"resourceId":  result.ResourceID,
			"downloadUrl": result.DownloadURL,
			"title":       result.Title,
		}
		for key, value := range quotaFields {
			resp[key] = value
		}
		c.JSON(http.StatusOK, resp)
	})

	router.POST("/api/user-image/share", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req userImageShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		transferDefaults, err := service.NormalizeResourceTransferDefaults(req.TransferDefaults)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		if limitMsg := service.ShareLimitMessageWithUnlimited(aiShareQuota, aiShareUnlimited, serial, service.MaxAISharesPerDevice); limitMsg != "" {
			quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
			aiShareMu.Unlock()
			resp := gin.H{
				"success": false,
				"message": limitMsg,
			}
			for key, value := range quotaFields {
				resp[key] = value
			}
			c.JSON(http.StatusTooManyRequests, resp)
			return
		}
		aiShareMu.Unlock()

		imageReviewMu.Lock()
		reviewItem, pending, modErr := service.ProcessImageModerationWithReview(
			c.Request.Context(),
			imsClient,
			imageSigner,
			&imageReviewStore,
			service.EnqueueImageReviewInput{
				Serial:           serial,
				Action:           service.ReviewActionShareUser,
				Title:            req.Title,
				Description:      req.Description,
				TransferDefaults: transferDefaults,
				Source:           "upload",
				ImageBase64:      req.ImageBase64,
			},
			serial+"-upload-share",
			"IMAGE",
		)
		if pending {
			saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore)
			imageReviewMu.Unlock()
			if saveErr != nil {
				log.Printf("warn: save image review queue failed: %v", saveErr)
			}
			writeImageReviewPending(c, reviewItem)
			return
		}
		imageReviewMu.Unlock()
		if modErr != nil {
			writeImageModerationError(c, modErr)
			return
		}

		profilesMu.RLock()
		author := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		result, err := service.ShareAIImageToCatalog(
			c.Request.Context(),
			imageSigner,
			imagePublicBase,
			resourcesPath,
			imageMapPath,
			service.ShareAIImageInput{
				ImageBase64:      req.ImageBase64,
				Prompt:           req.Description,
				Title:            req.Title,
				Author:           author,
				UploaderSerial:   serial,
				TransferDefaults: transferDefaults,
			},
		)
		if err != nil {
			log.Printf("warn: user image share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save user image share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		resp := gin.H{
			"success":     true,
			"resourceId":  result.ResourceID,
			"downloadUrl": result.DownloadURL,
			"title":       result.Title,
		}
		for key, value := range quotaFields {
			resp[key] = value
		}
		c.JSON(http.StatusOK, resp)
	})

	router.POST("/api/user-gif/upload-session", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if gifSigner == nil || gifCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "GIF 存储未配置"})
			return
		}

		var req userGifUploadSessionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		result, err := service.CreateGifUploadSession(
			c.Request.Context(),
			gifUploadSessionStore,
			service.CreateGifUploadSessionInput{
				Serial:      serial,
				FileName:    req.FileName,
				FileSize:    req.FileSize,
				GifSigner:   gifSigner,
				CoverSigner: gifCoverSigner,
			},
		)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"sessionId":      result.SessionID,
			"gifUploadUrl":   result.GifUploadURL,
			"coverUploadUrl": result.CoverUploadURL,
			"gifObjectKey":   result.GifObjectKey,
			"coverObjectKey": result.CoverObjectKey,
			"maxBytes":       result.MaxBytes,
		})
	})

	router.POST("/api/user-gif/upload", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if gifSigner == nil || gifCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "GIF 存储未配置"})
			return
		}

		sessionID := strings.TrimSpace(c.PostForm("sessionId"))
		kind := strings.TrimSpace(c.PostForm("kind"))
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sessionId 不能为空"})
			return
		}

		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少上传文件"})
			return
		}

		maxSize := int64(service.MaxUserGifUploadBytes)
		if strings.EqualFold(kind, "cover") {
			maxSize = 8 << 20
		}
		if fileHeader.Size <= 0 || fileHeader.Size > maxSize {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件大小无效"})
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取上传文件"})
			return
		}
		defer file.Close()

		data, err := io.ReadAll(io.LimitReader(file, maxSize+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取上传文件"})
			return
		}
		if int64(len(data)) > maxSize {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件过大"})
			return
		}

		if err := service.UploadGifSessionFile(
			c.Request.Context(),
			gifUploadSessionStore,
			gifSigner,
			gifCoverSigner,
			serial,
			sessionID,
			kind,
			data,
		); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	router.POST("/api/user-gif/share", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if gifSigner == nil || gifCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "GIF 存储未配置"})
			return
		}

		var req userGifShareRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.SessionID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sessionId 不能为空"})
			return
		}
		transferDefaults, err := service.NormalizeResourceTransferDefaults(req.TransferDefaults)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		if limitMsg := service.ShareLimitMessageWithUnlimited(aiShareQuota, aiShareUnlimited, serial, service.MaxAISharesPerDevice); limitMsg != "" {
			quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
			aiShareMu.Unlock()
			resp := gin.H{
				"success": false,
				"message": limitMsg,
			}
			for key, value := range quotaFields {
				resp[key] = value
			}
			c.JSON(http.StatusTooManyRequests, resp)
			return
		}
		aiShareMu.Unlock()

		session, err := gifUploadSessionStore.Consume(strings.TrimSpace(req.SessionID), serial)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		gifSize, err := service.VerifyUploadedGifObjects(c.Request.Context(), gifSigner, gifCoverSigner, session)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		profilesMu.RLock()
		author := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		title := strings.TrimSpace(req.Title)
		description := strings.TrimSpace(req.Description)
		if title == "" {
			title = strings.TrimSuffix(session.FileName, filepath.Ext(session.FileName))
		}
		if description == "" {
			description = title
		}

		reviewInput := service.EnqueueGifReviewInput{
			Serial:           serial,
			Author:           author,
			Title:            title,
			Description:      description,
			GifObjectKey:     session.GifObjectKey,
			CoverObjectKey:   session.CoverObjectKey,
			TransferDefaults: transferDefaults,
		}

		imageReviewMu.Lock()
		reviewItem, pending, modErr := service.ProcessGifShareModerationWithReview(
			c.Request.Context(),
			imsClient,
			gifSigner,
			gifCoverSigner,
			&imageReviewStore,
			reviewInput,
			serial+"-gif-share",
		)
		if pending {
			saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore)
			imageReviewMu.Unlock()
			if saveErr != nil {
				log.Printf("warn: save image review queue failed: %v", saveErr)
			}
			writeImageReviewPending(c, reviewItem)
			return
		}
		imageReviewMu.Unlock()
		if modErr != nil {
			writeImageModerationError(c, modErr)
			return
		}

		result, err := service.ShareUserGifToCatalog(
			resourcesPath,
			resourceMapPath,
			imageMapPath,
			service.ShareUserGifInput{
				Title:            title,
				Description:      description,
				Author:           author,
				UploaderSerial:   serial,
				GifObjectKey:     session.GifObjectKey,
				CoverObjectKey:   session.CoverObjectKey,
				GifSizeBytes:     gifSize,
				TransferDefaults: transferDefaults,
			},
		)
		if err != nil {
			log.Printf("warn: user gif share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save user gif share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		resp := gin.H{
			"success":     true,
			"resourceId":  result.ResourceID,
			"downloadUrl": result.DownloadURL,
			"title":       result.Title,
		}
		for key, value := range quotaFields {
			resp[key] = value
		}
		c.JSON(http.StatusOK, resp)
	})

	router.POST("/api/user-video/upload-session", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if videoSigner == nil || videoCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "视频存储未配置"})
			return
		}

		var req userVideoUploadSessionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		result, err := service.CreateVideoUploadSession(
			c.Request.Context(),
			videoUploadSessionStore,
			service.CreateVideoUploadSessionInput{
				Serial:      serial,
				FileName:    req.FileName,
				FileSize:    req.FileSize,
				VideoSigner: videoSigner,
				CoverSigner: videoCoverSigner,
			},
		)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"sessionId":      result.SessionID,
			"videoUploadUrl": result.VideoUploadURL,
			"coverUploadUrl": result.CoverUploadURL,
			"videoObjectKey": result.VideoObjectKey,
			"coverObjectKey": result.CoverObjectKey,
			"maxBytes":       result.MaxBytes,
		})
	})

	router.POST("/api/user-video/upload", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if videoSigner == nil || videoCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "视频存储未配置"})
			return
		}

		sessionID := strings.TrimSpace(c.PostForm("sessionId"))
		kind := strings.TrimSpace(c.PostForm("kind"))
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sessionId 不能为空"})
			return
		}

		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少上传文件"})
			return
		}

		maxSize := int64(service.MaxUserVideoUploadBytes)
		if strings.EqualFold(kind, "cover") {
			maxSize = 8 << 20
		}
		if fileHeader.Size <= 0 || fileHeader.Size > maxSize {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件大小无效"})
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取上传文件"})
			return
		}
		defer file.Close()

		data, err := io.ReadAll(io.LimitReader(file, maxSize+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取上传文件"})
			return
		}
		if int64(len(data)) > maxSize {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件过大"})
			return
		}

		if err := service.UploadVideoSessionFile(
			c.Request.Context(),
			videoUploadSessionStore,
			videoSigner,
			videoCoverSigner,
			serial,
			sessionID,
			kind,
			data,
		); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	router.POST("/api/user-video/share", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if videoSigner == nil || videoCoverSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "视频存储未配置"})
			return
		}

		var req userVideoShareRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.SessionID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sessionId 不能为空"})
			return
		}
		transferDefaults, err := service.NormalizeResourceTransferDefaults(req.TransferDefaults)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		if limitMsg := service.ShareLimitMessageWithUnlimited(aiShareQuota, aiShareUnlimited, serial, service.MaxAISharesPerDevice); limitMsg != "" {
			quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
			aiShareMu.Unlock()
			resp := gin.H{
				"success": false,
				"message": limitMsg,
			}
			for key, value := range quotaFields {
				resp[key] = value
			}
			c.JSON(http.StatusTooManyRequests, resp)
			return
		}
		aiShareMu.Unlock()

		session, err := videoUploadSessionStore.Consume(strings.TrimSpace(req.SessionID), serial)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		videoSize, err := service.VerifyUploadedVideoObjects(c.Request.Context(), videoSigner, videoCoverSigner, session)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}

		videoObjectKey := session.VideoObjectKey
		normalizedKey, normalizedSize, normErr := service.NormalizeVideoObjectForWebPlayback(
			c.Request.Context(),
			videoSigner,
			videoObjectKey,
		)
		if normErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": normErr.Error()})
			return
		}
		if strings.TrimSpace(normalizedKey) != "" {
			videoObjectKey = normalizedKey
		}
		if normalizedSize > 0 {
			videoSize = normalizedSize
		}

		profilesMu.RLock()
		author := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		title := strings.TrimSpace(req.Title)
		description := strings.TrimSpace(req.Description)
		if title == "" {
			title = strings.TrimSuffix(session.FileName, filepath.Ext(session.FileName))
		}
		if description == "" {
			description = title
		}

		columnTag := strings.TrimSpace(req.ColumnTag)

		reviewInput := service.EnqueueVideoReviewInput{
			Serial:           serial,
			Author:           author,
			Title:            title,
			Description:      description,
			ColumnTag:        columnTag,
			VideoObjectKey:   videoObjectKey,
			CoverObjectKey:   session.CoverObjectKey,
			TransferDefaults: transferDefaults,
		}

		imageReviewMu.Lock()
		reviewItem, pending, modErr := service.ProcessVideoShareModerationWithReview(
			c.Request.Context(),
			imsClient,
			vmClient,
			videoSigner,
			videoCoverSigner,
			&imageReviewStore,
			reviewInput,
			serial+"-video-share",
		)
		if pending {
			saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore)
			imageReviewMu.Unlock()
			if saveErr != nil {
				log.Printf("warn: save image review queue failed: %v", saveErr)
			}
			writeImageReviewPending(c, reviewItem)
			return
		}
		imageReviewMu.Unlock()
		if modErr != nil {
			writeImageModerationError(c, modErr)
			return
		}

		result, err := service.ShareUserVideoToCatalog(
			resourcesPath,
			resourceMapPath,
			imageMapPath,
			service.ShareUserVideoInput{
				Title:            title,
				Description:      description,
				ColumnTag:        columnTag,
				Author:           author,
				UploaderSerial:   serial,
				VideoObjectKey:   videoObjectKey,
				CoverObjectKey:   session.CoverObjectKey,
				VideoSizeBytes:   videoSize,
				TransferDefaults: transferDefaults,
			},
		)
		if err != nil {
			log.Printf("warn: user video share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadShareStoresLocked()
		aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		quotaFields := service.ShareQuotaFields(aiShareQuota, serial, aiShareUnlimited)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save user video share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		resp := gin.H{
			"success":     true,
			"resourceId":  result.ResourceID,
			"downloadUrl": result.DownloadURL,
			"title":       result.Title,
		}
		for key, value := range quotaFields {
			resp[key] = value
		}
		c.JSON(http.StatusOK, resp)
	})

	router.GET("/api/admin/image-reviews", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		status := strings.TrimSpace(c.Query("status"))
		if status == "" {
			status = service.ImageReviewStatusPending
		}

		imageReviewMu.RLock()
		items := imageReviewStore.List(status)
		imageReviewMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"items":   items,
			"total":   len(items),
		})
	})

	router.GET("/api/admin/image-reviews/:id", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		reviewID := strings.TrimSpace(c.Param("id"))

		imageReviewMu.RLock()
		item, _, ok := imageReviewStore.Find(reviewID)
		imageReviewMu.RUnlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "复核记录不存在"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "item": item})
	})

	router.GET("/api/admin/image-reviews/:id/image", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		reviewID := strings.TrimSpace(c.Param("id"))

		imageReviewMu.RLock()
		item, _, ok := imageReviewStore.Find(reviewID)
		imageReviewMu.RUnlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "复核记录不存在"})
			return
		}

		previewSigner := imageSigner
		previewObjectKey := item.ImageObjectKey
		if item.Action == service.ReviewActionShareUserGif {
			if gifCoverSigner == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "GIF 封面存储未配置"})
				return
			}
			previewSigner = gifCoverSigner
			if coverKey := strings.TrimSpace(item.CoverObjectKey); coverKey != "" {
				previewObjectKey = coverKey
			}
		}
		if item.Action == service.ReviewActionShareUserVideo {
			if videoCoverSigner == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "视频封面存储未配置"})
				return
			}
			previewSigner = videoCoverSigner
			if coverKey := strings.TrimSpace(item.CoverObjectKey); coverKey != "" {
				previewObjectKey = coverKey
			}
		}
		if previewSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "图片存储未配置"})
			return
		}

		signedURL, err := previewSigner.GenerateReadURL(c.Request.Context(), previewObjectKey, 30*time.Minute)
		if err != nil {
			log.Printf("warn: image review read url failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "读取待审图片失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":  true,
			"imageUrl": signedURL,
		})
	})

	router.POST("/api/admin/image-reviews/:id/approve", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		reviewID := strings.TrimSpace(c.Param("id"))

		var req imageReviewActionRequest
		_ = c.ShouldBindJSON(&req)

		imageReviewMu.Lock()
		item, _, ok := imageReviewStore.Find(reviewID)
		if !ok {
			imageReviewMu.Unlock()
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "复核记录不存在"})
			return
		}
		if item.Action == service.ReviewActionShareAI ||
			item.Action == service.ReviewActionShareUser ||
			item.Action == service.ReviewActionShareUserGif ||
			item.Action == service.ReviewActionShareUserVideo {
			aiShareMu.Lock()
			reloadShareStoresLocked()
			if limitMsg := service.ShareLimitMessageWithUnlimited(aiShareQuota, aiShareUnlimited, item.Serial, service.MaxAISharesPerDevice); limitMsg != "" {
				quotaFields := service.ShareQuotaFields(aiShareQuota, item.Serial, aiShareUnlimited)
				aiShareMu.Unlock()
				imageReviewMu.Unlock()
				resp := gin.H{
					"success": false,
					"message": limitMsg,
				}
				for key, value := range quotaFields {
					resp[key] = value
				}
				c.JSON(http.StatusTooManyRequests, resp)
				return
			}
			aiShareMu.Unlock()
		}

		result, err := service.ApprovePendingReview(
			c.Request.Context(),
			service.CatalogPublishDeps{
				ImageSigner:     imageSigner,
				VideoSigner:     videoSigner,
				ImagePublicBase: imagePublicBase,
				ResourcesPath:   resourcesPath,
				ImageMapPath:    imageMapPath,
				ResourceMapPath: resourceMapPath,
			},
			&imageReviewStore,
			reviewID,
			req.Note,
		)
		if err != nil {
			imageReviewMu.Unlock()
			status := http.StatusBadGateway
			if strings.Contains(err.Error(), "不支持") || strings.Contains(err.Error(), "已处理") {
				status = http.StatusBadRequest
			}
			c.JSON(status, gin.H{"success": false, "message": err.Error()})
			return
		}
		if saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore); saveErr != nil {
			imageReviewMu.Unlock()
			log.Printf("warn: save image review queue failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "复核状态保存失败"})
			return
		}
		imageReviewMu.Unlock()

		response := gin.H{
			"success":     true,
			"resourceId":  result.ResourceID,
			"downloadUrl": result.DownloadURL,
			"title":       result.Title,
			"message":     "已通过复核并发布到素材库",
		}
		if item.Action == service.ReviewActionShareAI ||
			item.Action == service.ReviewActionShareUser ||
			item.Action == service.ReviewActionShareUserGif ||
			item.Action == service.ReviewActionShareUserVideo {
			aiShareMu.Lock()
			reloadShareStoresLocked()
			aiShareQuota.RecordShare(item.Serial)
			saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
			quotaFields := service.ShareQuotaFields(aiShareQuota, item.Serial, aiShareUnlimited)
			aiShareMu.Unlock()
			if saveErr != nil {
				log.Printf("warn: save ai image share counts after review approve failed: %v", saveErr)
			} else {
				for key, value := range quotaFields {
					response[key] = value
				}
			}
		}

		c.JSON(http.StatusOK, response)
	})

	router.POST("/api/admin/image-reviews/:id/reject", func(c *gin.Context) {
		if !ensureReviewAdmin(c, reviewAdminToken) {
			return
		}
		reviewID := strings.TrimSpace(c.Param("id"))

		var req imageReviewActionRequest
		_ = c.ShouldBindJSON(&req)

		imageReviewMu.Lock()
		item, err := service.RejectPendingImageReview(&imageReviewStore, reviewID, req.Note)
		if err != nil {
			imageReviewMu.Unlock()
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "不存在") {
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"success": false, "message": err.Error()})
			return
		}
		if saveErr := service.SaveImageReviewStore(imageReviewPath, imageReviewStore); saveErr != nil {
			imageReviewMu.Unlock()
			log.Printf("warn: save image review queue failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "复核状态保存失败"})
			return
		}
		imageReviewMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"item":    item,
			"message": "已拒绝该图片",
		})
	})

	router.GET("/api/resource-likes", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		serial = service.NormalizeLikeSerial(serial)

		likesMu.RLock()
		counts := make(map[string]int, len(likes.Counts))
		for id, count := range likes.Counts {
			if count < 0 {
				count = 0
			}
			counts[id] = count
		}
		likedResourceIDs := service.LikedResourceIDsForSerial(&likes, serial)
		likesMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":          true,
			"counts":           counts,
			"likedResourceIds": likedResourceIDs,
		})
	})

	router.POST("/api/resource-like", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, likeTokenRateLimiter, likeIPRateLimiter, serial, "点赞过于频繁，请稍后再试") {
			return
		}
		serial = service.NormalizeLikeSerial(serial)

		var req likeRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ResourceID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)

		var alreadyLiked bool
		var likeCount int

		likesMu.Lock()
		if userDataRepo.UsesMySQL() {
			result, applyErr := userDataRepo.ApplyDeviceLike(serial, resourceID)
			if applyErr != nil {
				likesMu.Unlock()
				log.Printf("apply device like failed: %v", applyErr)
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "点赞保存失败"})
				return
			}
			alreadyLiked = result.AlreadyLiked
			likeCount = result.LikeCount
			service.SyncDeviceLikeInMemory(&likes, serial, resourceID, likeCount)
		} else {
			alreadyLiked, likeCount = service.ApplyDeviceLikeInMemory(&likes, serial, resourceID)
			if saveErr := userDataRepo.SaveLikes(likes); saveErr != nil {
				if !alreadyLiked {
					service.RollbackDeviceLikeInMemory(&likes, serial, resourceID)
				}
				likesMu.Unlock()
				log.Printf("save likes failed: %v", saveErr)
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "点赞保存失败"})
				return
			}
		}
		likesMu.Unlock()

		creditRewarded := false
		creditRewardAmount := 0.0
		actorCreditRewarded := false
		actorCreditRewardAmount := 0.0
		dailyLikeRewardLimitReached := false
		if !alreadyLiked {
			catalogItems, catalogErr := loadResourceCatalog(resourcesPath)
			if catalogErr != nil {
				log.Printf("warn: load resource catalog for like reward failed: %v", catalogErr)
			} else {
				uploaderSerial := service.FindUploaderSerial(catalogItems, resourceID)
				aiCreditsMu.Lock()
				reloadAICreditsLocked()
				reloadCreditRewardStoresLocked()
				award, awardErr := service.ApplyLikeCreditRewards(
					&aiCredits,
					&creditLikeGrants,
					&creditDailyRewards,
					uploaderSerial,
					serial,
					resourceID,
					time.Now(),
				)
				if awardErr != nil {
					log.Printf("warn: apply like credit rewards failed: %v", awardErr)
				} else {
					dailyLikeRewardLimitReached = award.DailyLimitReached
				}
				if awardErr == nil && (award.UploaderRewarded || award.ActorRewarded) {
					if creditSaveErr := userDataRepo.SaveAICredits(aiCredits); creditSaveErr != nil {
						log.Printf("warn: save like reward credits failed: %v", creditSaveErr)
					} else {
						if grantSaveErr := userDataRepo.SaveCreditLikeGrants(creditLikeGrants); grantSaveErr != nil {
							log.Printf("warn: save credit like grants failed: %v", grantSaveErr)
						}
						if dailySaveErr := userDataRepo.SaveCreditDailyRewards(creditDailyRewards); dailySaveErr != nil {
							log.Printf("warn: save credit daily rewards failed: %v", dailySaveErr)
						}
						if award.UploaderRewarded {
							creditRewarded = true
							creditRewardAmount = award.UploaderCredits()
							if ledgerErr := userDataRepo.RecordCreditChange(
								service.NormalizeRewardSerial(uploaderSerial),
								award.UploaderUnits,
								service.CreditSourceLikeReward,
								"",
								resourceID,
							); ledgerErr != nil {
								log.Printf("warn: record like reward ledger failed: %v", ledgerErr)
							}
						}
						if award.ActorRewarded {
							actorCreditRewarded = true
							actorCreditRewardAmount = award.ActorCredits()
							if ledgerErr := userDataRepo.RecordCreditChange(
								service.NormalizeRewardSerial(serial),
								award.ActorUnits,
								service.CreditSourceLikeActorReward,
								"",
								resourceID,
							); ledgerErr != nil {
								log.Printf("warn: record actor like reward ledger failed: %v", ledgerErr)
							}
						}
					}
				}
				aiCreditsMu.Unlock()
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"success":                     true,
			"alreadyLiked":                alreadyLiked,
			"liked":                       true,
			"likeCount":                   likeCount,
			"creditRewarded":              creditRewarded,
			"creditRewardAmount":          creditRewardAmount,
			"actorCreditRewarded":         actorCreditRewarded,
			"actorCreditRewardAmount":     actorCreditRewardAmount,
			"dailyLikeRewardLimitReached": dailyLikeRewardLimitReached,
			"dailyLikeRewardLimit":        service.CreditDailyActorLikeLimit,
		})
	})

	router.GET("/api/resource-favorites", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		favoritesMu.RLock()
		counts := make(map[string]int, len(favorites.Counts))
		for id, count := range favorites.Counts {
			if count < 0 {
				count = 0
			}
			counts[id] = count
		}
		favoriteResourceIDs := service.FavoriteResourceIDsForSerial(favorites, serial)
		favoritesMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":             true,
			"counts":              counts,
			"favoriteResourceIds": favoriteResourceIDs,
		})
	})

	router.POST("/api/resource-favorite", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, likeTokenRateLimiter, likeIPRateLimiter, serial, "收藏操作过于频繁，请稍后再试") {
			return
		}

		var req favoriteRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ResourceID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)
		action := strings.ToLower(strings.TrimSpace(req.Action))
		if action == "" {
			action = "toggle"
		}
		if action != "toggle" && action != "add" && action != "remove" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "action 无效"})
			return
		}

		favoritesMu.Lock()
		if favorites.DeviceFavorites[serial] == nil {
			favorites.DeviceFavorites[serial] = map[string]int64{}
		}
		if favorites.Counts == nil {
			favorites.Counts = map[string]int{}
		}
		deviceFavorites := favorites.DeviceFavorites[serial]
		_, exists := deviceFavorites[resourceID]
		favorited := exists
		favoriteCount := favorites.Counts[resourceID]
		if favoriteCount < 0 {
			favoriteCount = 0
		}
		switch action {
		case "add":
			if !exists {
				deviceFavorites[resourceID] = time.Now().Unix()
				favorited = true
				favoriteCount = service.AdjustFavoriteCount(&favorites, resourceID, 1)
			}
		case "remove":
			if exists {
				delete(deviceFavorites, resourceID)
				favorited = false
				favoriteCount = service.AdjustFavoriteCount(&favorites, resourceID, -1)
			}
		case "toggle":
			if exists {
				delete(deviceFavorites, resourceID)
				favorited = false
				favoriteCount = service.AdjustFavoriteCount(&favorites, resourceID, -1)
			} else {
				deviceFavorites[resourceID] = time.Now().Unix()
				favorited = true
				favoriteCount = service.AdjustFavoriteCount(&favorites, resourceID, 1)
			}
		}
		favoriteResourceIDs := service.FavoriteResourceIDsForSerial(favorites, serial)
		saveErr := userDataRepo.SaveFavorites(favorites)
		favoritesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "收藏保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":             true,
			"favorited":           favorited,
			"favoriteCount":       favoriteCount,
			"favoriteResourceIds": favoriteResourceIDs,
		})
	})

	router.GET("/api/resource-hidden", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		blockedSerials, err := userDataRepo.ListBlockedUploaders(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "屏蔽列表加载失败"})
			return
		}
		catalogItems, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success":              true,
			"hiddenResourceIds":    service.ResourceIDsByUploaderSerials(catalogItems, blockedSerials),
			"blockedUploaderCount": len(blockedSerials),
		})
	})

	router.POST("/api/resource-hidden", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, likeTokenRateLimiter, likeIPRateLimiter, serial, "屏蔽操作过于频繁，请稍后再试") {
			return
		}
		var req hiddenResourceRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ResourceID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}
		catalogItems, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		uploaderSerial := service.FindUploaderSerial(catalogItems, req.ResourceID)
		if uploaderSerial == "" {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "未找到该素材的上传设备"})
			return
		}
		if strings.EqualFold(serial, uploaderSerial) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不能屏蔽当前设备自己上传的素材"})
			return
		}
		blockedSerials, err := userDataRepo.SetUploaderBlocked(serial, uploaderSerial, req.Hidden)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "屏蔽设置保存失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success":              true,
			"hidden":               req.Hidden,
			"hiddenResourceIds":    service.ResourceIDsByUploaderSerials(catalogItems, blockedSerials),
			"blockedUploaderCount": len(blockedSerials),
		})
	})

	router.GET("/api/resource-follows", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		followedSerials, err := userDataRepo.ListFollowedUploaders(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "关注列表加载失败"})
			return
		}
		catalogItems, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success":               true,
			"followedResourceIds":   service.ResourceIDsByUploaderSerials(catalogItems, followedSerials),
			"followedUploaderCount": len(followedSerials),
			"ownResourceIds":        service.ResourceIDsByUploaderSerials(catalogItems, []string{serial}),
		})
	})

	router.POST("/api/resource-follow", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, likeTokenRateLimiter, likeIPRateLimiter, serial, "关注操作过于频繁，请稍后再试") {
			return
		}
		var req followResourceRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ResourceID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}
		catalogItems, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "素材目录加载失败"})
			return
		}
		uploaderSerial := service.FindUploaderSerial(catalogItems, req.ResourceID)
		if uploaderSerial == "" {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "未找到该素材的上传者"})
			return
		}
		if strings.EqualFold(serial, uploaderSerial) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不能关注自己"})
			return
		}
		followedSerials, err := userDataRepo.SetUploaderFollowed(serial, uploaderSerial, req.Followed)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "关注设置保存失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success":               true,
			"followed":              req.Followed,
			"followedResourceIds":   service.ResourceIDsByUploaderSerials(catalogItems, followedSerials),
			"followedUploaderCount": len(followedSerials),
			"ownResourceIds":        service.ResourceIDsByUploaderSerials(catalogItems, []string{serial}),
		})
	})

	router.GET("/api/resource-downloads", func(c *gin.Context) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret, tokenTTL) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		downloadsMu.Lock()
		downloads.EnsureCurrentWeek(time.Now())
		totalCounts := make(map[string]int, len(downloads.TotalCounts))
		for id, count := range downloads.TotalCounts {
			if count < 0 {
				count = 0
			}
			totalCounts[id] = count
		}
		weeklyCounts := make(map[string]int, len(downloads.WeeklyCounts))
		for id, count := range downloads.WeeklyCounts {
			if count < 0 {
				count = 0
			}
			weeklyCounts[id] = count
		}
		weekKey := downloads.WeekKey
		downloadsMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"success":      true,
			"weekKey":      weekKey,
			"totalCounts":  totalCounts,
			"weeklyCounts": weeklyCounts,
		})
	})

	router.POST("/api/resource-download", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			abuseGuard.RecordInvalidToken(ginClientIP(c))
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if !requireDeviceFeatureAccess(c, serial) {
			return
		}
		if abuseGuard.RejectDownloadSign(c, ginClientIP(c), serial) {
			return
		}

		var req downloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)
		if resourceID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 不能为空"})
			return
		}

		now := time.Now()
		downloadsMu.Lock()
		downloads.EnsureDeviceWindow(serial, now)
		downloads.EnsureCurrentWeek(now)
		window := downloads.DeviceWindows[serial]
		totalCount := downloads.TotalCounts[resourceID]
		weeklyCount := downloads.WeeklyCounts[resourceID]
		weekKey := downloads.WeekKey
		limitMsg := downloads.DeviceDownloadLimitMessage(serial, now)
		downloadsMu.Unlock()

		if limitMsg != "" {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success":     false,
				"message":     limitMsg,
				"hourlyCount": window.HourCount,
				"dailyCount":  window.DayCount,
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"weekKey":     weekKey,
			"totalCount":  totalCount,
			"weeklyCount": weeklyCount,
			"hourlyCount": window.HourCount,
			"dailyCount":  window.DayCount,
		})
	})

	awardDownloadCreditReward := func(downloaderSerial, resourceID string, now time.Time) {
		catalogItems, catalogErr := loadResourceCatalog(resourcesPath)
		if catalogErr != nil {
			log.Printf("warn: load resource catalog for download reward failed: %v", catalogErr)
			return
		}
		uploaderSerial := service.FindUploaderSerial(catalogItems, resourceID)
		aiCreditsMu.Lock()
		defer aiCreditsMu.Unlock()
		reloadAICreditsLocked()
		reloadCreditRewardStoresLocked()
		award, awardErr := service.ApplyDownloadCreditReward(
			&aiCredits,
			&creditDailyRewards,
			uploaderSerial,
			downloaderSerial,
			resourceID,
			now,
		)
		if awardErr != nil {
			log.Printf("warn: apply download credit reward failed: %v", awardErr)
			return
		}
		if !award.Rewarded {
			return
		}
		if creditSaveErr := userDataRepo.SaveAICredits(aiCredits); creditSaveErr != nil {
			log.Printf("warn: save download reward credits failed: %v", creditSaveErr)
			return
		}
		if dailySaveErr := userDataRepo.SaveCreditDailyRewards(creditDailyRewards); dailySaveErr != nil {
			log.Printf("warn: save credit daily rewards failed: %v", dailySaveErr)
		}
		if ledgerErr := userDataRepo.RecordCreditChange(
			service.NormalizeRewardSerial(uploaderSerial),
			award.Units,
			service.CreditSourceDownloadReward,
			"",
			resourceID,
		); ledgerErr != nil {
			log.Printf("warn: record download reward ledger failed: %v", ledgerErr)
		}
	}

	handleResource := func(c *gin.Context, id string, previewOnly bool) {
		clientIP := ginClientIP(c)
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			abuseGuard.RecordInvalidToken(clientIP)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}
		if previewOnly {
			if abuseGuard.RejectRead(c, clientIP) {
				return
			}
		} else if abuseGuard.RejectDownloadSign(c, clientIP, serial) {
			return
		}
		if c.Query("webusb") != "1" && (!previewOnly || c.Query("blob") == "1") && !requireDeviceFeatureAccess(c, serial) {
			return
		}

		rawObjectKey, ok := resourceMapStore.get(id)
		objectKey := normalizeObjectKey(rawObjectKey)
		if !ok || objectKey == "" {
			abuseGuard.RecordNotFound(clientIP)
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		}

		now := time.Now()
		var window service.DeviceDownloadWindow
		var totalCount int
		var weeklyCount int
		var weekKey string
		if !previewOnly {
			downloadsMu.Lock()
			var limitMsg string
			window, totalCount, weeklyCount, limitMsg = downloads.AttemptDeviceDownload(serial, id, now)
			weekKey = downloads.WeekKey
			saveErr := userDataRepo.SaveDownloads(downloads)
			downloadsMu.Unlock()
			if limitMsg != "" {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error":       limitMsg,
					"hourlyCount": window.HourCount,
					"dailyCount":  window.DayCount,
				})
				return
			}
			if saveErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "download stats save failed"})
				return
			}
			recordResourceInteraction(serial, id, service.ResourceInteractionDownload, now)
			awardDownloadCreditReward(serial, id, now)
		}

		selectedSigner := signer
		if isSoftwareObjectKey(objectKey) {
			selectedSigner = softwareSigner
		} else if isGIFObjectKey(objectKey) {
			selectedSigner = gifSigner
		} else if isVideoObjectKey(objectKey) {
			selectedSigner = videoSigner
		}

		// Preview already grants a short-lived signed URL to the complete object.
		// Allow the same authenticated preview request to stream the object as a
		// CORS fallback without recording a second download.
		if c.Query("blob") == "1" {
			writeTransferBlob(c, selectedSigner, objectKey)
			return
		}

		url, signErr := selectedSigner.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
		if signErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign url failed"})
			return
		}

		if previewOnly {
			c.JSON(http.StatusOK, gin.H{"url": url})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"url": url,
			"downloadStats": gin.H{
				"weekKey":     weekKey,
				"totalCount":  totalCount,
				"weeklyCount": weeklyCount,
				"hourlyCount": window.HourCount,
				"dailyCount":  window.DayCount,
			},
		})
	}

	handleImage := func(c *gin.Context, id string, forDownload bool) {
		clientIP := ginClientIP(c)
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			abuseGuard.RecordInvalidToken(clientIP)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}
		if forDownload {
			if abuseGuard.RejectDownloadSign(c, clientIP, serial) {
				return
			}
		} else if abuseGuard.RejectRead(c, clientIP) {
			return
		}
		if c.Query("webusb") != "1" && (forDownload || c.Query("blob") == "1") && !requireDeviceFeatureAccess(c, serial) {
			return
		}

		rawImageObjectKey, ok := imageMapStore.get(id)
		objectKey := normalizeObjectKey(rawImageObjectKey)
		if !ok || objectKey == "" {
			abuseGuard.RecordNotFound(clientIP)
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
		var window service.DeviceDownloadWindow
		var totalCount int
		var weeklyCount int
		var weekKey string
		if forDownload {
			downloadsMu.Lock()
			var limitMsg string
			window, totalCount, weeklyCount, limitMsg = downloads.AttemptDeviceDownload(serial, id, now)
			weekKey = downloads.WeekKey
			saveErr := userDataRepo.SaveDownloads(downloads)
			downloadsMu.Unlock()
			if limitMsg != "" {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error":       limitMsg,
					"hourlyCount": window.HourCount,
					"dailyCount":  window.DayCount,
				})
				return
			}
			if saveErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "download stats save failed"})
				return
			}
			recordResourceInteraction(serial, id, service.ResourceInteractionDownload, now)
		}

		// Allow blob streaming for CORS fallback even when this request is not
		// counted as a download (preview + blob), matching /api/resource.
		if c.Query("blob") == "1" {
			writeTransferBlob(c, selectedImageSigner, objectKey)
			return
		}

		forceRefresh := c.Query("refresh") == "1"
		imageURLCacheMu.RLock()
		cached, hasCached := imageURLCache[cacheKey]
		imageURLCacheMu.RUnlock()
		if !forceRefresh && hasCached && cached.expiresAt.After(now) {
			if forDownload {
				c.JSON(http.StatusOK, gin.H{
					"url": cached.url,
					"downloadStats": gin.H{
						"weekKey":     weekKey,
						"totalCount":  totalCount,
						"weeklyCount": weeklyCount,
						"hourlyCount": window.HourCount,
						"dailyCount":  window.DayCount,
					},
				})
				return
			}
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

		if forDownload {
			c.JSON(http.StatusOK, gin.H{
				"url": url,
				"downloadStats": gin.H{
					"weekKey":     weekKey,
					"totalCount":  totalCount,
					"weeklyCount": weeklyCount,
					"hourlyCount": window.HourCount,
					"dailyCount":  window.DayCount,
				},
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{"url": url})
	}

	router.GET("/api/resource/:id", func(c *gin.Context) {
		handleResource(c, c.Param("id"), c.Query("preview") == "1" && c.Query("download") != "1")
	})
	router.GET("/api/resource/", func(c *gin.Context) {
		handleResource(c, c.Query("id"), c.Query("preview") == "1" && c.Query("download") != "1")
	})
	router.GET("/api/image/:id", func(c *gin.Context) {
		handleImage(c, c.Param("id"), c.Query("download") == "1")
	})
	router.GET("/api/image/", func(c *gin.Context) {
		handleImage(c, c.Query("id"), c.Query("download") == "1")
	})
	resolveMessageProfiles := func(ctx context.Context, entries []service.MessageEntry) {
		for i := range entries {
			serial := strings.TrimSpace(entries[i].Serial)
			if serial == "" {
				continue
			}
			profilesMu.RLock()
			entries[i].Username = service.ResolveStoredDisplayName(userProfiles, serial, "")
			avatarKey := userProfiles.Avatars[serial]
			profilesMu.RUnlock()
			if strings.TrimSpace(avatarKey) == "" {
				continue
			}
			avatarURL, err := imageSigner.GenerateReadURL(ctx, avatarKey, 24*time.Hour)
			if err != nil {
				log.Printf("warn: sign message avatar failed for %s: %v", serial, err)
				continue
			}
			entries[i].AvatarURL = avatarURL
		}
	}

	router.GET("/api/messages", func(c *gin.Context) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret, tokenTTL) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		limit := maxMessagesPerPage
		if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
			if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
				limit = parsed
				if limit > maxMessagesPerPage {
					limit = maxMessagesPerPage
				}
			}
		}

		resourceID := strings.TrimSpace(c.Query("resourceId"))
		if len(resourceID) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 无效"})
			return
		}

		messagesMu.RLock()
		filtered := make([]service.MessageEntry, 0)
		for _, entry := range messages.Messages {
			if strings.TrimSpace(entry.ResourceID) == resourceID {
				filtered = append(filtered, entry)
			}
		}
		messagesMu.RUnlock()
		total := len(filtered)
		start := total - limit
		if start < 0 {
			start = 0
		}
		slice := make([]service.MessageEntry, len(filtered[start:]))
		copy(slice, filtered[start:])

		for i, j := 0, len(slice)-1; i < j; i, j = i+1, j-1 {
			slice[i], slice[j] = slice[j], slice[i]
		}

		resolveMessageProfiles(c.Request.Context(), slice)

		c.JSON(http.StatusOK, gin.H{
			"success":  true,
			"messages": slice,
			"total":    total,
		})
	})

	router.POST("/api/messages", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, messageTokenRateLimiter, messageIPRateLimiter, serial, "留言过于频繁，请稍后再试") {
			return
		}

		var req messagePostRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		content := strings.TrimSpace(req.Content)
		if content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "留言内容不能为空"})
			return
		}
		if len([]rune(content)) > maxMessageLength {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": fmt.Sprintf("留言最多%d字", maxMessageLength)})
			return
		}
		resourceID := strings.TrimSpace(req.ResourceID)
		if len(resourceID) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "resourceId 无效"})
			return
		}
		if resourceID != "" {
			_, hasResource := resourceMapStore.get(resourceID)
			_, hasImage := imageMapStore.get(resourceID)
			if !hasResource && !hasImage {
				c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "素材不存在或已下架"})
				return
			}
		}

		entry := service.MessageEntry{
			ID:         newMessageID(),
			ResourceID: resourceID,
			Serial:     serial,
			Username: func() string {
				profilesMu.RLock()
				defer profilesMu.RUnlock()
				return service.ResolveStoredDisplayName(userProfiles, serial, req.DisplayName)
			}(),
			Content:   content,
			CreatedAt: time.Now().UnixMilli(),
		}

		messagesMu.Lock()
		messages.Messages = append(messages.Messages, entry)
		saveErr := userDataRepo.SaveMessages(messages)
		messagesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "留言保存失败"})
			return
		}
		responseEntries := []service.MessageEntry{entry}
		resolveMessageProfiles(c.Request.Context(), responseEntries)

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": responseEntries[0],
		})
	})

	registerAdminRoutes(router, reviewAdminToken)
	registerActivityRoutes(router, activityRouteDeps{
		activityService:      activityService,
		reviewAdminToken:     reviewAdminToken,
		jwtSecret:            jwtSecret,
		tokenTTL:             tokenTTL,
		activityTokenLimiter: activityTokenRateLimiter,
		activityIPLimiter:    activityIPRateLimiter,
	})
	registerMallRoutes(router, mallRouteDeps{
		mallService:      mallService,
		reviewAdminToken: reviewAdminToken,
		jwtSecret:        jwtSecret,
		tokenTTL:         tokenTTL,
		imageSigner:      imageSigner,
		imageCOSBucket:   imageCOSBucket,
		imagePublicBase:  imagePublicBase,
		imageSignTTL:     imageSignTTL,
	})
	registerPromoRoutes(router, promoRouteDeps{
		promoService:     promoService,
		reviewAdminToken: reviewAdminToken,
		jwtSecret:        jwtSecret,
		tokenTTL:         tokenTTL,
		imageSigner:      imageSigner,
		imagePublicBase:  imagePublicBase,
	})

	if err := runAPIHTTPServer(newAPIHTTPServer(":"+port, router)); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server run failed: %v", err)
	}
}
