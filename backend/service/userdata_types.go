package service

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	MaxDownloadsPerHour = 50
	MaxDownloadsPerDay  = 100
)

func maxDownloadsPerHour() int {
	return parseDownloadLimitEnv("MAX_DOWNLOADS_PER_HOUR", MaxDownloadsPerHour)
}

func maxDownloadsPerDay() int {
	return parseDownloadLimitEnv("MAX_DOWNLOADS_PER_DAY", MaxDownloadsPerDay)
}

func parseDownloadLimitEnv(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		if !apiRateLimitsEnabled() {
			return 0
		}
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

type LikesStore struct {
	Counts      map[string]int             `json:"counts"`
	DeviceLikes map[string]map[string]bool `json:"deviceLikes"`
}

type FavoritesStore struct {
	Counts          map[string]int              `json:"counts"`
	DeviceFavorites map[string]map[string]int64 `json:"deviceFavorites"`
}

type DeviceDownloadWindow struct {
	HourKey   string `json:"hourKey"`
	DayKey    string `json:"dayKey"`
	HourCount int    `json:"hourCount"`
	DayCount  int    `json:"dayCount"`
}

type DownloadsStore struct {
	TotalCounts   map[string]int                  `json:"totalCounts"`
	WeekKey       string                          `json:"weekKey"`
	WeeklyCounts  map[string]int                  `json:"weeklyCounts"`
	DeviceWindows map[string]DeviceDownloadWindow `json:"deviceWindows"`
}

type MessageEntry struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"createdAt"`
	Serial    string `json:"serial,omitempty"`
}

type MessagesStore struct {
	Messages []MessageEntry `json:"messages"`
}

func CurrentWeekKey(now time.Time) string {
	year, week := now.ISOWeek()
	return fmt.Sprintf("%d-W%02d", year, week)
}

func currentDayKey(now time.Time) string {
	return now.Format("2006-01-02")
}

func currentHourKey(now time.Time) string {
	return now.Format("2006-01-02T15")
}

func FavoriteResourceIDsForSerial(store FavoritesStore, serial string) []string {
	deviceMap := store.DeviceFavorites[serial]
	if len(deviceMap) == 0 {
		return []string{}
	}
	type favoritePair struct {
		id string
		ts int64
	}
	pairs := make([]favoritePair, 0, len(deviceMap))
	for id, ts := range deviceMap {
		if strings.TrimSpace(id) == "" {
			continue
		}
		pairs = append(pairs, favoritePair{id: id, ts: ts})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].ts == pairs[j].ts {
			return pairs[i].id > pairs[j].id
		}
		return pairs[i].ts > pairs[j].ts
	})
	ids := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		ids = append(ids, pair.id)
	}
	return ids
}

func RemoveResourceFromAllFavorites(store *FavoritesStore, resourceID string) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" || store == nil {
		return
	}
	if store.DeviceFavorites != nil {
		for serial := range store.DeviceFavorites {
			delete(store.DeviceFavorites[serial], resourceID)
		}
	}
	if store.Counts != nil {
		delete(store.Counts, resourceID)
	}
}

func ReconcileFavoriteCounts(store *FavoritesStore) bool {
	if store == nil {
		return false
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	for _, count := range store.Counts {
		if count > 0 {
			return false
		}
	}
	hasDevices := false
	for _, deviceMap := range store.DeviceFavorites {
		if len(deviceMap) > 0 {
			hasDevices = true
			break
		}
	}
	if !hasDevices {
		return false
	}
	rebuilt := map[string]int{}
	for _, deviceMap := range store.DeviceFavorites {
		for resourceID := range deviceMap {
			rebuilt[resourceID]++
		}
	}
	store.Counts = rebuilt
	return true
}

func AdjustFavoriteCount(store *FavoritesStore, resourceID string, delta int) int {
	if store == nil {
		return 0
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return 0
	}
	count := store.Counts[resourceID] + delta
	if count < 0 {
		count = 0
	}
	store.Counts[resourceID] = count
	return count
}

func (store *DownloadsStore) EnsureDeviceWindow(serial string, now time.Time) {
	if store.DeviceWindows == nil {
		store.DeviceWindows = map[string]DeviceDownloadWindow{}
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

func (store *DownloadsStore) DeviceDownloadLimitMessage(serial string, now time.Time) string {
	store.EnsureDeviceWindow(serial, now)
	window := store.DeviceWindows[serial]
	hourLimit := maxDownloadsPerHour()
	if hourLimit > 0 && window.HourCount >= hourLimit {
		return fmt.Sprintf("每小时最多下载%d次，请稍后再试", hourLimit)
	}
	dayLimit := maxDownloadsPerDay()
	if dayLimit > 0 && window.DayCount >= dayLimit {
		return fmt.Sprintf("每天最多下载%d次，请明天再试", dayLimit)
	}
	return ""
}

func (store *DownloadsStore) AttemptDeviceDownload(serial, resourceID string, now time.Time) (DeviceDownloadWindow, int, int, string) {
	store.EnsureDeviceWindow(serial, now)
	if limitMsg := store.DeviceDownloadLimitMessage(serial, now); limitMsg != "" {
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

func (store *DownloadsStore) EnsureCurrentWeek(now time.Time) {
	weekKey := CurrentWeekKey(now)
	if store.WeekKey != weekKey {
		store.WeekKey = weekKey
		store.WeeklyCounts = map[string]int{}
	}
}

func (store *DownloadsStore) recordDownload(resourceID string, now time.Time) {
	store.EnsureCurrentWeek(now)
	if store.TotalCounts == nil {
		store.TotalCounts = map[string]int{}
	}
	if store.WeeklyCounts == nil {
		store.WeeklyCounts = map[string]int{}
	}
	store.TotalCounts[resourceID] = store.TotalCounts[resourceID] + 1
	store.WeeklyCounts[resourceID] = store.WeeklyCounts[resourceID] + 1
}

func NewEmptyLikesStore() LikesStore {
	return LikesStore{
		Counts:      map[string]int{},
		DeviceLikes: map[string]map[string]bool{},
	}
}

type DeviceLikeResult struct {
	AlreadyLiked bool
	LikeCount    int
}

func ensureLikesStoreMaps(store *LikesStore) {
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.DeviceLikes == nil {
		store.DeviceLikes = map[string]map[string]bool{}
	}
}

func NormalizeLikeSerial(serial string) string {
	return normalizeUploaderSerial(serial)
}

func DeviceLikesForSerial(store *LikesStore, serial string) map[string]bool {
	ensureLikesStoreMaps(store)
	serial = NormalizeLikeSerial(serial)
	if serial == "" {
		return nil
	}
	if liked := store.DeviceLikes[serial]; liked != nil {
		return liked
	}
	for key, liked := range store.DeviceLikes {
		if NormalizeLikeSerial(key) == serial {
			return liked
		}
	}
	return nil
}

func LikedResourceIDsForSerial(store *LikesStore, serial string) []string {
	likedMap := DeviceLikesForSerial(store, serial)
	if len(likedMap) == 0 {
		return []string{}
	}
	ids := make([]string, 0, len(likedMap))
	for id, liked := range likedMap {
		if liked {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// ApplyDeviceLikeInMemory marks one like and returns previous/new state for rollback.
func ApplyDeviceLikeInMemory(store *LikesStore, serial, resourceID string) (alreadyLiked bool, likeCount int) {
	ensureLikesStoreMaps(store)
	serial = NormalizeLikeSerial(serial)
	resourceID = strings.TrimSpace(resourceID)
	if serial == "" || resourceID == "" {
		return false, 0
	}
	if store.DeviceLikes[serial] == nil {
		store.DeviceLikes[serial] = map[string]bool{}
	}
	alreadyLiked = store.DeviceLikes[serial][resourceID]
	if !alreadyLiked {
		store.DeviceLikes[serial][resourceID] = true
		store.Counts[resourceID] = store.Counts[resourceID] + 1
	}
	likeCount = store.Counts[resourceID]
	if likeCount < 0 {
		likeCount = 0
	}
	return alreadyLiked, likeCount
}

func RollbackDeviceLikeInMemory(store *LikesStore, serial, resourceID string) {
	ensureLikesStoreMaps(store)
	serial = NormalizeLikeSerial(serial)
	resourceID = strings.TrimSpace(resourceID)
	if serial == "" || resourceID == "" {
		return
	}
	if liked := store.DeviceLikes[serial]; liked != nil {
		delete(liked, resourceID)
	}
	if store.Counts[resourceID] > 0 {
		store.Counts[resourceID] = store.Counts[resourceID] - 1
	}
	if store.Counts[resourceID] <= 0 {
		delete(store.Counts, resourceID)
	}
}

func SyncDeviceLikeInMemory(store *LikesStore, serial, resourceID string, likeCount int) {
	ensureLikesStoreMaps(store)
	serial = NormalizeLikeSerial(serial)
	resourceID = strings.TrimSpace(resourceID)
	if serial == "" || resourceID == "" {
		return
	}
	if store.DeviceLikes[serial] == nil {
		store.DeviceLikes[serial] = map[string]bool{}
	}
	store.DeviceLikes[serial][resourceID] = true
	if likeCount < 0 {
		likeCount = 0
	}
	store.Counts[resourceID] = likeCount
}

func RemoveResourceFromAllLikes(store *LikesStore, resourceID string) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" || store == nil {
		return
	}
	ensureLikesStoreMaps(store)
	delete(store.Counts, resourceID)
	for serial := range store.DeviceLikes {
		delete(store.DeviceLikes[serial], resourceID)
	}
}

func NewEmptyFavoritesStore() FavoritesStore {
	return FavoritesStore{
		Counts:          map[string]int{},
		DeviceFavorites: map[string]map[string]int64{},
	}
}

func NewEmptyDownloadsStore(now time.Time) DownloadsStore {
	return DownloadsStore{
		TotalCounts:   map[string]int{},
		WeekKey:       CurrentWeekKey(now),
		WeeklyCounts:  map[string]int{},
		DeviceWindows: map[string]DeviceDownloadWindow{},
	}
}

func NewEmptyMessagesStore() MessagesStore {
	return MessagesStore{Messages: []MessageEntry{}}
}
