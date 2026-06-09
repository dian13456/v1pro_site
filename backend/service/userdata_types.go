package service

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	MaxDownloadsPerHour = 50
	MaxDownloadsPerDay  = 100
)

type LikesStore struct {
	Counts      map[string]int             `json:"counts"`
	DeviceLikes map[string]map[string]bool `json:"deviceLikes"`
}

type FavoritesStore struct {
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
	if window.HourCount >= MaxDownloadsPerHour {
		return fmt.Sprintf("每小时最多下载%d次，请稍后再试", MaxDownloadsPerHour)
	}
	if window.DayCount >= MaxDownloadsPerDay {
		return fmt.Sprintf("每天最多下载%d次，请明天再试", MaxDownloadsPerDay)
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

func NewEmptyFavoritesStore() FavoritesStore {
	return FavoritesStore{DeviceFavorites: map[string]map[string]int64{}}
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
