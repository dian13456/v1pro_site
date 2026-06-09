package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func loadJSONFile(path string, target any, empty func() any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return json.Unmarshal(mustMarshal(empty()), target)
		}
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return json.Unmarshal(mustMarshal(empty()), target)
	}
	return json.Unmarshal(raw, target)
}

func saveJSONFile(path string, store any) error {
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

func mustMarshal(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

func loadLikesJSON(path string) (LikesStore, error) {
	var store LikesStore
	err := loadJSONFile(path, &store, func() any { return NewEmptyLikesStore() })
	if err != nil {
		return LikesStore{}, err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.DeviceLikes == nil {
		store.DeviceLikes = map[string]map[string]bool{}
	}
	return store, nil
}

func saveLikesJSON(path string, store LikesStore) error {
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.DeviceLikes == nil {
		store.DeviceLikes = map[string]map[string]bool{}
	}
	return saveJSONFile(path, store)
}

func loadFavoritesJSON(path string) (FavoritesStore, error) {
	var store FavoritesStore
	err := loadJSONFile(path, &store, func() any { return NewEmptyFavoritesStore() })
	if err != nil {
		return FavoritesStore{}, err
	}
	if store.DeviceFavorites == nil {
		store.DeviceFavorites = map[string]map[string]int64{}
	}
	return store, nil
}

func saveFavoritesJSON(path string, store FavoritesStore) error {
	if store.DeviceFavorites == nil {
		store.DeviceFavorites = map[string]map[string]int64{}
	}
	return saveJSONFile(path, store)
}

func loadDownloadsJSON(path string) (DownloadsStore, error) {
	var store DownloadsStore
	err := loadJSONFile(path, &store, func() any { return NewEmptyDownloadsStore(time.Now()) })
	if err != nil {
		return DownloadsStore{}, err
	}
	if store.TotalCounts == nil {
		store.TotalCounts = map[string]int{}
	}
	if store.WeeklyCounts == nil {
		store.WeeklyCounts = map[string]int{}
	}
	if store.DeviceWindows == nil {
		store.DeviceWindows = map[string]DeviceDownloadWindow{}
	}
	if strings.TrimSpace(store.WeekKey) == "" {
		store.WeekKey = CurrentWeekKey(time.Now())
	}
	return store, nil
}

func saveDownloadsJSON(path string, store DownloadsStore) error {
	return saveJSONFile(path, store)
}

func loadMessagesJSON(path string) (MessagesStore, error) {
	var store MessagesStore
	err := loadJSONFile(path, &store, func() any { return NewEmptyMessagesStore() })
	if err != nil {
		return MessagesStore{}, err
	}
	if store.Messages == nil {
		store.Messages = []MessageEntry{}
	}
	return store, nil
}

func saveMessagesJSON(path string, store MessagesStore) error {
	if store.Messages == nil {
		store.Messages = []MessageEntry{}
	}
	return saveJSONFile(path, store)
}
