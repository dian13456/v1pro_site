package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	ItemID string `json:"itemId"`
}

type favoriteRequest struct {
	ResourceID string `json:"resourceId"`
	Action     string `json:"action"`
}

type downloadRequest struct {
	ResourceID string `json:"resourceId"`
}

const (
	maxMessageLength   = 500
	maxMessagesPerPage = 100
)

type profilePostRequest struct {
	DisplayName string `json:"displayName"`
}

type messagePostRequest struct {
	Content     string `json:"content"`
	DisplayName string `json:"displayName"`
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
	ImageBase64 string `json:"imageBase64"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type userGifUploadSessionRequest struct {
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
}

type userGifShareRequest struct {
	SessionID   string `json:"sessionId"`
	Title       string `json:"title"`
	Description string `json:"description"`
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
	if token == "" || token != reviewAdminToken {
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
	wildcard := strings.TrimSpace(allowOrigin) == "" || strings.TrimSpace(allowOrigin) == "*"
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		switch {
		case origin != "" && wildcard:
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		case origin != "" && len(allowed) > 1 && corsOriginAllowed(origin, allowed):
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		case len(allowed) == 1:
			c.Header("Access-Control-Allow-Origin", allowed[0])
		case origin == "" && wildcard:
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Review-Admin-Token, X-Api-Timestamp, X-Api-Nonce, X-Api-Signature")
		c.Header("Access-Control-Allow-Credentials", "false")
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
	resourceFavoritesPath := os.Getenv("RESOURCE_FAVORITES_PATH")
	if resourceFavoritesPath == "" {
		resourceFavoritesPath = filepath.Join("config", "resource_favorites.json")
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
	aiImageSharesPath := os.Getenv("AI_IMAGE_SHARES_PATH")
	if aiImageSharesPath == "" {
		aiImageSharesPath = filepath.Join("config", "ai_image_share_counts.json")
	}
	aiImageCreditsPath := os.Getenv("AI_IMAGE_CREDITS_PATH")
	if aiImageCreditsPath == "" {
		aiImageCreditsPath = filepath.Join("config", "ai_image_credits.json")
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
	imsClient, err := service.NewImageModerationClient(imsSecretID, imsSecretKey, imsRegion, imsBizType, imsEnabled)
	if err != nil {
		log.Fatalf("init image moderation failed: %v", err)
	}
	if imsClient.Available() {
		log.Printf("info: Tencent IMS image moderation enabled (aigcType=%s bizType=%s)", imsAigcModerationType, imsBizType)
	} else {
		log.Printf("warn: IMS image moderation disabled or not configured")
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
		LikesPath:     resourceLikesPath,
		FavoritesPath: resourceFavoritesPath,
		DownloadsPath: resourceDownloadsPath,
		MessagesPath:  messageBoardPath,
		ProfilesPath:  userProfilesPath,
		CreditsPath:   aiImageCreditsPath,
		SharesPath:    aiImageSharesPath,
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
	aiShareQuota, err := userDataRepo.LoadAIShareQuota()
	if err != nil {
		log.Fatalf("load ai image share counts failed: %v", err)
	}
	aiCredits, err := userDataRepo.LoadAICredits()
	if err != nil {
		log.Fatalf("load ai image credits failed: %v", err)
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
	reloadAIShareQuotaLocked := func() {
		if err := userDataRepo.TryReloadAIShareQuota(&aiShareQuota); err != nil {
			log.Printf("warn: reload ai share quota failed: %v", err)
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
	reviewAdminToken := strings.TrimSpace(os.Getenv("REVIEW_ADMIN_TOKEN"))

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
	var favoritesMu sync.RWMutex
	var downloadsMu sync.Mutex
	var messagesMu sync.RWMutex
	var profilesMu sync.RWMutex
	var aiShareMu sync.Mutex
	var aiCreditsMu sync.Mutex
	var imageReviewMu sync.RWMutex
	imageSignTTL := 10 * time.Minute
	// 给缓存留 30 秒安全边界，避免返回临过期签名链接。
	imageCacheReuseTTL := imageSignTTL - 30*time.Second
	imagePublicBase := strings.TrimSpace(os.Getenv("IMAGE_COS_PUBLIC_BASE"))
	if imagePublicBase == "" && imageCOSBucket != "" && imageCOSRegion != "" {
		imagePublicBase = fmt.Sprintf("https://%s.cos.%s.myqcloud.com", imageCOSBucket, imageCOSRegion)
	}

	router := gin.Default()
	router.Use(corsMiddleware(corsAllowOrigin))
	router.Use(apiSignVerifier.Middleware())
	router.Use(abuseGuard.Middleware())

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
			"success":   true,
			"available": available,
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

		profilesMu.RLock()
		displayName := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		aiCreditsMu.Lock()
		reloadAICreditsLocked()
		credits := aiCredits.Balance(serial)
		aiCreditsMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"serial":         serial,
			"displayName":    displayName,
			"credits":           credits,
			"creditsDefault":    service.DefaultAICredits,
			"creditCost":        service.AICreditCostPerGeneration,
			"likeRewardCredits": service.LikeCreditRewardAmount,
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
		balance := aiCredits.Balance(serial)
		aiCreditsMu.Unlock()
		c.JSON(http.StatusOK, gin.H{
			"success":           true,
			"credits":           balance,
			"likeRewardCredits": service.LikeCreditRewardAmount,
			"items":             shopCatalog.PublicItems(),
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
		reloadAIShareQuotaLocked()
		result, redeemErr := service.RedeemShopItem(
			service.ShopRedeemInput{Serial: serial, ItemID: req.ItemID},
			shopCatalog,
			&aiCredits,
			&aiShareQuota,
		)
		if redeemErr != nil {
			balance := aiCredits.Balance(serial)
			aiShareMu.Unlock()
			aiCreditsMu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{
				"success":  false,
				"message":  redeemErr.Error(),
				"credits":  balance,
			})
			return
		}
		if saveErr := userDataRepo.SaveAICredits(aiCredits); saveErr != nil {
			aiShareMu.Unlock()
			aiCreditsMu.Unlock()
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "积分保存失败"})
			return
		}
		if item, found := shopCatalog.FindItem(strings.TrimSpace(req.ItemID)); found && item.Effect.Type == service.ShopEffectResetAIShare {
			if saveShareErr := userDataRepo.SaveAIShareQuota(aiShareQuota); saveShareErr != nil {
				aiShareMu.Unlock()
				aiCreditsMu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享次数保存失败"})
				return
			}
		}
		aiShareMu.Unlock()
		aiCreditsMu.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"success":          true,
			"message":          result.Message,
			"itemId":           result.ItemID,
			"title":            result.Title,
			"cost":             result.Cost,
			"creditsRemaining": result.CreditsRemaining,
			"rewardCredits":    result.RewardCredits,
			"redeemCode":       result.RedeemCode,
			"shareCount":       result.ShareCount,
			"shareRemaining":   result.ShareRemaining,
		})
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
		credits := aiCredits.Balance(serial)
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
		c.JSON(http.StatusOK, service.SanitizePublicResourceCatalog(items))
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
		creditsRemaining, spendErr := aiCredits.Spend(serial, service.AICreditCostPerGeneration)
		if spendErr != nil {
			balance := aiCredits.Balance(serial)
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
			aiCredits.Refund(serial, service.AICreditCostPerGeneration)
			aiCreditsMu.Unlock()
			log.Printf("warn: save ai image credits failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "积分扣减失败，请稍后重试"})
			return
		}
		aiCreditsMu.Unlock()

		result, err := minimaxClient.GenerateImages(
			c.Request.Context(),
			req.Prompt,
			req.AspectRatio,
			req.Count,
		)
		if err != nil {
			aiCreditsMu.Lock()
			reloadAICreditsLocked()
			creditsRemaining = aiCredits.Refund(serial, service.AICreditCostPerGeneration)
			if refundErr := userDataRepo.SaveAICredits(aiCredits); refundErr != nil {
				log.Printf("warn: refund ai image credits failed: %v", refundErr)
			}
			aiCreditsMu.Unlock()
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
		reloadAIShareQuotaLocked()
		if limitMsg := aiShareQuota.ShareLimitMessage(serial, service.MaxAISharesPerDevice); limitMsg != "" {
			shareCount := aiShareQuota.ShareCount(serial)
			aiShareMu.Unlock()
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success":    false,
				"message":    limitMsg,
				"shareCount": shareCount,
				"shareLimit": service.MaxAISharesPerDevice,
			})
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
		reloadAIShareQuotaLocked()
		shareCount := aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save ai image share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":          true,
			"resourceId":       result.ResourceID,
			"downloadUrl":      result.DownloadURL,
			"title":            result.Title,
			"shareCount":       shareCount,
			"shareLimit":       service.MaxAISharesPerDevice,
			"shareRemaining":   service.RemainingAIShares(shareCount, service.MaxAISharesPerDevice),
		})
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

		aiShareMu.Lock()
		reloadAIShareQuotaLocked()
		if limitMsg := aiShareQuota.ShareLimitMessage(serial, service.MaxAISharesPerDevice); limitMsg != "" {
			shareCount := aiShareQuota.ShareCount(serial)
			aiShareMu.Unlock()
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success":    false,
				"message":    limitMsg,
				"shareCount": shareCount,
				"shareLimit": service.MaxAISharesPerDevice,
			})
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
				Serial:      serial,
				Action:      service.ReviewActionShareUser,
				Title:       req.Title,
				Description: req.Description,
				Source:      "upload",
				ImageBase64: req.ImageBase64,
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
				ImageBase64:    req.ImageBase64,
				Prompt:         req.Description,
				Title:          req.Title,
				Author:         author,
				UploaderSerial: serial,
			},
		)
		if err != nil {
			log.Printf("warn: user image share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadAIShareQuotaLocked()
		shareCount := aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save user image share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"resourceId":     result.ResourceID,
			"downloadUrl":    result.DownloadURL,
			"title":          result.Title,
			"shareCount":     shareCount,
			"shareLimit":     service.MaxAISharesPerDevice,
			"shareRemaining": service.RemainingAIShares(shareCount, service.MaxAISharesPerDevice),
		})
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

		aiShareMu.Lock()
		reloadAIShareQuotaLocked()
		if limitMsg := aiShareQuota.ShareLimitMessage(serial, service.MaxAISharesPerDevice); limitMsg != "" {
			shareCount := aiShareQuota.ShareCount(serial)
			aiShareMu.Unlock()
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success":    false,
				"message":    limitMsg,
				"shareCount": shareCount,
				"shareLimit": service.MaxAISharesPerDevice,
			})
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
			Serial:         serial,
			Author:         author,
			Title:          title,
			Description:    description,
			GifObjectKey:   session.GifObjectKey,
			CoverObjectKey: session.CoverObjectKey,
		}

		imageReviewMu.Lock()
		reviewItem, pending, modErr := service.ProcessGifShareModerationWithReview(
			c.Request.Context(),
			imsClient,
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
				Title:          title,
				Description:    description,
				Author:         author,
				UploaderSerial: serial,
				GifObjectKey:   session.GifObjectKey,
				CoverObjectKey: session.CoverObjectKey,
				GifSizeBytes:   gifSize,
			},
		)
		if err != nil {
			log.Printf("warn: user gif share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		reloadAIShareQuotaLocked()
		shareCount := aiShareQuota.RecordShare(serial)
		saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
		aiShareMu.Unlock()
		if saveErr != nil {
			log.Printf("warn: save user gif share counts failed: %v", saveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "分享计数保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":        true,
			"resourceId":     result.ResourceID,
			"downloadUrl":    result.DownloadURL,
			"title":          result.Title,
			"shareCount":     shareCount,
			"shareLimit":     service.MaxAISharesPerDevice,
			"shareRemaining": service.RemainingAIShares(shareCount, service.MaxAISharesPerDevice),
		})
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
			item.Action == service.ReviewActionShareUserGif {
			aiShareMu.Lock()
			reloadAIShareQuotaLocked()
			if limitMsg := aiShareQuota.ShareLimitMessage(item.Serial, service.MaxAISharesPerDevice); limitMsg != "" {
				shareCount := aiShareQuota.ShareCount(item.Serial)
				aiShareMu.Unlock()
				imageReviewMu.Unlock()
				c.JSON(http.StatusTooManyRequests, gin.H{
					"success":    false,
					"message":    limitMsg,
					"shareCount": shareCount,
					"shareLimit": service.MaxAISharesPerDevice,
				})
				return
			}
			aiShareMu.Unlock()
		}

		result, err := service.ApprovePendingReview(
			c.Request.Context(),
			service.CatalogPublishDeps{
				ImageSigner:     imageSigner,
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
			item.Action == service.ReviewActionShareUserGif {
			aiShareMu.Lock()
			reloadAIShareQuotaLocked()
			shareCount := aiShareQuota.RecordShare(item.Serial)
			saveErr := userDataRepo.SaveAIShareQuota(aiShareQuota)
			aiShareMu.Unlock()
			if saveErr != nil {
				log.Printf("warn: save ai image share counts after review approve failed: %v", saveErr)
			} else {
				response["shareCount"] = shareCount
				response["shareLimit"] = service.MaxAISharesPerDevice
				response["shareRemaining"] = service.RemainingAIShares(shareCount, service.MaxAISharesPerDevice)
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
		serial, ok := serialFromToken(token, jwtSecret, tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, likeTokenRateLimiter, likeIPRateLimiter, serial, "点赞过于频繁，请稍后再试") {
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
		saveErr := userDataRepo.SaveLikes(likes)
		likesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "点赞保存失败"})
			return
		}

		creditRewarded := false
		creditRewardAmount := 0
		if !alreadyLiked {
			catalogItems, catalogErr := loadResourceCatalog(resourcesPath)
			if catalogErr != nil {
				log.Printf("warn: load resource catalog for like reward failed: %v", catalogErr)
			} else {
				uploaderSerial := service.FindUploaderSerial(catalogItems, resourceID)
				if service.ShouldAwardLikeCredit(uploaderSerial, serial) {
					aiCreditsMu.Lock()
					reloadAICreditsLocked()
					if _, earnErr := aiCredits.Earn(uploaderSerial, service.LikeCreditRewardAmount); earnErr == nil {
						if creditSaveErr := userDataRepo.SaveAICredits(aiCredits); creditSaveErr != nil {
							log.Printf("warn: save like reward credits failed: %v", creditSaveErr)
						} else {
							creditRewarded = true
							creditRewardAmount = service.LikeCreditRewardAmount
						}
					}
					aiCreditsMu.Unlock()
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"success":            true,
			"alreadyLiked":       alreadyLiked,
			"liked":              true,
			"likeCount":          likeCount,
			"creditRewarded":     creditRewarded,
			"creditRewardAmount": creditRewardAmount,
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
		favoriteResourceIDs := service.FavoriteResourceIDsForSerial(favorites, serial)
		favoritesMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":             true,
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
		deviceFavorites := favorites.DeviceFavorites[serial]
		_, exists := deviceFavorites[resourceID]
		favorited := exists
		switch action {
		case "add":
			if !exists {
				deviceFavorites[resourceID] = time.Now().Unix()
				favorited = true
			}
		case "remove":
			if exists {
				delete(deviceFavorites, resourceID)
				favorited = false
			}
		case "toggle":
			if exists {
				delete(deviceFavorites, resourceID)
				favorited = false
			} else {
				deviceFavorites[resourceID] = time.Now().Unix()
				favorited = true
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
			"favoriteResourceIds": favoriteResourceIDs,
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
			"success":      true,
			"weekKey":      weekKey,
			"totalCount":   totalCount,
			"weeklyCount":  weeklyCount,
			"hourlyCount":  window.HourCount,
			"dailyCount":   window.DayCount,
		})
	})

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
		}

		imageURLCacheMu.RLock()
		cached, hasCached := imageURLCache[cacheKey]
		imageURLCacheMu.RUnlock()
		if hasCached && cached.expiresAt.After(now) {
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

		messagesMu.RLock()
		total := len(messages.Messages)
		start := total - limit
		if start < 0 {
			start = 0
		}
		slice := make([]service.MessageEntry, len(messages.Messages[start:]))
		copy(slice, messages.Messages[start:])
		messagesMu.RUnlock()

		for i, j := 0, len(slice)-1; i < j; i, j = i+1, j-1 {
			slice[i], slice[j] = slice[j], slice[i]
		}

		profilesMu.RLock()
		for i := range slice {
			if strings.TrimSpace(slice[i].Serial) != "" {
				slice[i].Username = service.ResolveStoredDisplayName(userProfiles, slice[i].Serial, "")
			}
		}
		profilesMu.RUnlock()

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

		entry := service.MessageEntry{
			ID:     newMessageID(),
			Serial: serial,
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

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": entry,
		})
	})

	if err := router.Run(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server run failed: %v", err)
	}
}
