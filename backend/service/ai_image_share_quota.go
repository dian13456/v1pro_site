package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxAISharesPerDevice = 50

type AIShareQuotaStore struct {
	Counts map[string]int `json:"counts"`
}

func LoadAIShareQuotaStore(path string) (AIShareQuotaStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return AIShareQuotaStore{Counts: map[string]int{}}, nil
		}
		return AIShareQuotaStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return AIShareQuotaStore{Counts: map[string]int{}}, nil
	}
	var store AIShareQuotaStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return AIShareQuotaStore{}, err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	return store, nil
}

func SaveAIShareQuotaStore(path string, store AIShareQuotaStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

// TryReloadAIShareQuotaStore reloads from disk when the file changed.
func TryReloadAIShareQuotaStore(path string, current *AIShareQuotaStore, lastMod *time.Time) error {
	if current == nil || lastMod == nil {
		return fmt.Errorf("invalid reload state")
	}
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !lastMod.IsZero() && !info.ModTime().After(*lastMod) {
		return nil
	}
	latest, err := LoadAIShareQuotaStore(path)
	if err != nil {
		return err
	}
	*current = latest
	*lastMod = info.ModTime()
	return nil
}

func (store AIShareQuotaStore) ShareCount(serial string) int {
	serial = strings.TrimSpace(serial)
	if serial == "" || store.Counts == nil {
		return 0
	}
	count := store.Counts[serial]
	if count < 0 {
		return 0
	}
	return count
}

func (store AIShareQuotaStore) ShareLimitMessage(serial string, limit int) string {
	if limit <= 0 {
		limit = MaxAISharesPerDevice
	}
	count := store.ShareCount(serial)
	if count >= limit {
		return fmt.Sprintf("每台设备最多分享 %d 次，您的额度已用完（已用 %d 次）", limit, count)
	}
	return ""
}

func (store *AIShareQuotaStore) RecordShare(serial string) int {
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0
	}
	store.Counts[serial] = store.ShareCount(serial) + 1
	return store.Counts[serial]
}

func RemainingAIShares(count, limit int) int {
	if limit <= 0 {
		limit = MaxAISharesPerDevice
	}
	remaining := limit - count
	if remaining < 0 {
		return 0
	}
	return remaining
}
