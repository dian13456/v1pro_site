package main

import (
	"crypto/rand"
	"crypto/sha256"
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

type likesStore struct {
	Counts      map[string]int             `json:"counts"`
	DeviceLikes map[string]map[string]bool `json:"deviceLikes"`
}

type likeRequest struct {
	ResourceID string `json:"resourceId"`
}

type downloadsStore struct {
	TotalCounts   map[string]int                    `json:"totalCounts"`
	WeekKey       string                            `json:"weekKey"`
	WeeklyCounts  map[string]int                    `json:"weeklyCounts"`
	DeviceWindows map[string]deviceDownloadWindow   `json:"deviceWindows"`
}

type deviceDownloadWindow struct {
	HourKey   string `json:"hourKey"`
	DayKey    string `json:"dayKey"`
	HourCount int    `json:"hourCount"`
	DayCount  int    `json:"dayCount"`
}

type downloadRequest struct {
	ResourceID string `json:"resourceId"`
}

const (
	maxDownloadsPerHour = 50
	maxDownloadsPerDay  = 100
	maxMessageLength    = 500
	maxMessagesPerPage  = 100
)

type messageEntry struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"createdAt"`
	Serial    string `json:"serial,omitempty"`
}

type messagesStore struct {
	Messages []messageEntry `json:"messages"`
}

type messagePostRequest struct {
	Content     string `json:"content"`
	DisplayName string `json:"displayName"`
}

type profilePostRequest struct {
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
}

type aiImageShareRequest struct {
	ImageBase64 string `json:"imageBase64"`
	Prompt      string `json:"prompt"`
	Title       string `json:"title"`
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

func loadMessagesStore(path string) (messagesStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return messagesStore{Messages: []messageEntry{}}, nil
		}
		return messagesStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return messagesStore{Messages: []messageEntry{}}, nil
	}
	var store messagesStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return messagesStore{}, err
	}
	if store.Messages == nil {
		store.Messages = []messageEntry{}
	}
	return store, nil
}

func saveMessagesStore(path string, store messagesStore) error {
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

func currentWeekKey(now time.Time) string {
	year, week := now.ISOWeek()
	return fmt.Sprintf("%d-W%02d", year, week)
}

func loadDownloadsStore(path string) (downloadsStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			now := time.Now()
			return downloadsStore{
				TotalCounts:   map[string]int{},
				WeekKey:       currentWeekKey(now),
				WeeklyCounts:  map[string]int{},
				DeviceWindows: map[string]deviceDownloadWindow{},
			}, nil
		}
		return downloadsStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		now := time.Now()
		return downloadsStore{
			TotalCounts:  map[string]int{},
			WeekKey:      currentWeekKey(now),
			WeeklyCounts: map[string]int{},
		}, nil
	}
	var store downloadsStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return downloadsStore{}, err
	}
	if store.TotalCounts == nil {
		store.TotalCounts = map[string]int{}
	}
	if store.WeeklyCounts == nil {
		store.WeeklyCounts = map[string]int{}
	}
	if store.DeviceWindows == nil {
		store.DeviceWindows = map[string]deviceDownloadWindow{}
	}
	if strings.TrimSpace(store.WeekKey) == "" {
		store.WeekKey = currentWeekKey(time.Now())
	}
	return store, nil
}

func saveDownloadsStore(path string, store downloadsStore) error {
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

func currentDayKey(now time.Time) string {
	return now.Format("2006-01-02")
}

func currentHourKey(now time.Time) string {
	return now.Format("2006-01-02T15")
}

func (store *downloadsStore) ensureDeviceWindow(serial string, now time.Time) {
	if store.DeviceWindows == nil {
		store.DeviceWindows = map[string]deviceDownloadWindow{}
	}
	hourKey := currentHourKey(now)
	dayKey := currentDayKey(now)
	window := store.DeviceWindows[serial]
	if window.HourKey != hourKey {
		window.HourKey = hourKey
		window.HourCount = 0
	}
	if window.DayKey != dayKey {
		window.DayKey = dayKey
		window.DayCount = 0
	}
	store.DeviceWindows[serial] = window
}

func (store *downloadsStore) deviceDownloadLimitMessage(serial string, now time.Time) string {
	store.ensureDeviceWindow(serial, now)
	window := store.DeviceWindows[serial]
	if window.HourCount >= maxDownloadsPerHour {
		return fmt.Sprintf("每小时最多下载%d次，请稍后再试", maxDownloadsPerHour)
	}
	if window.DayCount >= maxDownloadsPerDay {
		return fmt.Sprintf("每天最多下载%d次，请明天再试", maxDownloadsPerDay)
	}
	return ""
}

func (store *downloadsStore) attemptDeviceDownload(serial, resourceID string, now time.Time) (deviceDownloadWindow, int, int, string) {
	store.ensureDeviceWindow(serial, now)
	if limitMsg := store.deviceDownloadLimitMessage(serial, now); limitMsg != "" {
		window := store.DeviceWindows[serial]
		totalCount := store.TotalCounts[resourceID]
		weeklyCount := store.WeeklyCounts[resourceID]
		return window, totalCount, weeklyCount, limitMsg
	}

	window := store.DeviceWindows[serial]
	window.HourCount++
	window.DayCount++
	store.DeviceWindows[serial] = window
	store.recordDownload(resourceID, now)
	return window, store.TotalCounts[resourceID], store.WeeklyCounts[resourceID], ""
}

func (store *downloadsStore) ensureCurrentWeek(now time.Time) {
	weekKey := currentWeekKey(now)
	if store.WeekKey != weekKey {
		store.WeekKey = weekKey
		store.WeeklyCounts = map[string]int{}
	}
}

func (store *downloadsStore) recordDownload(resourceID string, now time.Time) {
	store.ensureCurrentWeek(now)
	if store.TotalCounts == nil {
		store.TotalCounts = map[string]int{}
	}
	if store.WeeklyCounts == nil {
		store.WeeklyCounts = map[string]int{}
	}
	store.TotalCounts[resourceID] = store.TotalCounts[resourceID] + 1
	store.WeeklyCounts[resourceID] = store.WeeklyCounts[resourceID] + 1
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
	downloads, err := loadDownloadsStore(resourceDownloadsPath)
	if err != nil {
		log.Fatalf("load resource downloads failed: %v", err)
	}
	messages, err := loadMessagesStore(messageBoardPath)
	if err != nil {
		log.Fatalf("load message board failed: %v", err)
	}
	userProfiles, err := service.LoadUserProfiles(userProfilesPath)
	if err != nil {
		log.Fatalf("load user profiles failed: %v", err)
	}
	aiShareQuota, err := service.LoadAIShareQuotaStore(aiImageSharesPath)
	if err != nil {
		log.Fatalf("load ai image share counts failed: %v", err)
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
	var downloadsMu sync.Mutex
	var messagesMu sync.RWMutex
	var profilesMu sync.RWMutex
	var aiShareMu sync.Mutex
	imageSignTTL := 10 * time.Minute
	// 给缓存留 30 秒安全边界，避免返回临过期签名链接。
	imageCacheReuseTTL := imageSignTTL - 30*time.Second
	imagePublicBase := strings.TrimSpace(os.Getenv("IMAGE_COS_PUBLIC_BASE"))
	if imagePublicBase == "" && imageCOSBucket != "" && imageCOSRegion != "" {
		imagePublicBase = fmt.Sprintf("https://%s.cos.%s.myqcloud.com", imageCOSBucket, imageCOSRegion)
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

	router.GET("/api/welcome", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
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

	router.GET("/api/profile", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		profilesMu.RLock()
		displayName := service.ResolveStoredDisplayName(userProfiles, serial, "")
		profilesMu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"serial":      serial,
			"displayName": displayName,
		})
	})

	router.POST("/api/profile", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
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
		displayName := service.SetStoredDisplayName(&userProfiles, serial, req.DisplayName)
		saveErr := service.SaveUserProfiles(userProfilesPath, userProfiles)
		profilesMu.Unlock()
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "昵称保存失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"serial":      serial,
			"displayName": displayName,
		})
	})

	router.GET("/api/resources", func(c *gin.Context) {
		items, err := loadResourceCatalog(resourcesPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "load resources failed"})
			return
		}
		c.JSON(http.StatusOK, items)
	})

	router.GET("/api/column-tags", func(c *gin.Context) {
		items, err := loadColumnTags(columnTagsPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "load column tags failed"})
			return
		}
		c.JSON(http.StatusOK, items)
	})

	router.POST("/api/ai-guide", func(c *gin.Context) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
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
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
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

		result, err := minimaxClient.GenerateImages(
			c.Request.Context(),
			req.Prompt,
			req.AspectRatio,
			req.Count,
		)
		if err != nil {
			log.Printf("warn: minimax image generation failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"images":  result.Images,
			"mode":    "minimax",
		})
	})

	router.POST("/api/ai-image/transfer", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req aiImageTransferRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
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
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		var req aiImageShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}

		aiShareMu.Lock()
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
				ImageBase64: req.ImageBase64,
				Prompt:      req.Prompt,
				Title:       req.Title,
				Author:      author,
			},
		)
		if err != nil {
			log.Printf("warn: ai image share failed: %v", err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}

		aiShareMu.Lock()
		shareCount := aiShareQuota.RecordShare(serial)
		saveErr := service.SaveAIShareQuotaStore(aiImageSharesPath, aiShareQuota)
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

	router.GET("/api/resource-downloads", func(c *gin.Context) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}

		downloadsMu.Lock()
		downloads.ensureCurrentWeek(time.Now())
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
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
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
		downloads.ensureDeviceWindow(serial, now)
		downloads.ensureCurrentWeek(now)
		window := downloads.DeviceWindows[serial]
		totalCount := downloads.TotalCounts[resourceID]
		weeklyCount := downloads.WeeklyCounts[resourceID]
		weekKey := downloads.WeekKey
		limitMsg := downloads.deviceDownloadLimitMessage(serial, now)
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
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token 无效"})
			return
		}

		rawObjectKey, ok := resourceMapStore.get(id)
		objectKey := normalizeObjectKey(rawObjectKey)
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		}

		now := time.Now()
		var window deviceDownloadWindow
		var totalCount int
		var weeklyCount int
		var weekKey string
		if !previewOnly {
			downloadsMu.Lock()
			var limitMsg string
			window, totalCount, weeklyCount, limitMsg = downloads.attemptDeviceDownload(serial, id, now)
			weekKey = downloads.WeekKey
			saveErr := saveDownloadsStore(resourceDownloadsPath, downloads)
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
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
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
		var window deviceDownloadWindow
		var totalCount int
		var weeklyCount int
		var weekKey string
		if forDownload {
			downloadsMu.Lock()
			var limitMsg string
			window, totalCount, weeklyCount, limitMsg = downloads.attemptDeviceDownload(serial, id, now)
			weekKey = downloads.WeekKey
			saveErr := saveDownloadsStore(resourceDownloadsPath, downloads)
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
		handleResource(c, c.Param("id"), c.Query("preview") == "1")
	})
	router.GET("/api/resource/", func(c *gin.Context) {
		handleResource(c, c.Query("id"), c.Query("preview") == "1")
	})
	router.GET("/api/image/:id", func(c *gin.Context) {
		handleImage(c, c.Param("id"), c.Query("download") == "1")
	})
	router.GET("/api/image/", func(c *gin.Context) {
		handleImage(c, c.Query("id"), c.Query("download") == "1")
	})

	router.GET("/api/messages", func(c *gin.Context) {
		token := parseBearerToken(c)
		if !verifyToken(token, jwtSecret) {
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
		slice := make([]messageEntry, len(messages.Messages[start:]))
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
		serial, ok := serialFromToken(token, jwtSecret)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
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

		entry := messageEntry{
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
		saveErr := saveMessagesStore(messageBoardPath, messages)
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
