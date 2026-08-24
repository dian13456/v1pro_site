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
	Counts     map[string]int `json:"counts"`
	ExtraQuota map[string]int `json:"extraQuota,omitempty"`
}

func LoadAIShareQuotaStore(path string) (AIShareQuotaStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return newAIShareQuotaStore(), nil
		}
		return AIShareQuotaStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return newAIShareQuotaStore(), nil
	}
	var store AIShareQuotaStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return AIShareQuotaStore{}, err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.ExtraQuota == nil {
		store.ExtraQuota = map[string]int{}
	}
	return store, nil
}

func newAIShareQuotaStore() AIShareQuotaStore {
	return AIShareQuotaStore{
		Counts:     map[string]int{},
		ExtraQuota: map[string]int{},
	}
}

func (store AIShareQuotaStore) Clone() AIShareQuotaStore {
	clone := newAIShareQuotaStore()
	for serial, count := range store.Counts {
		clone.Counts[serial] = count
	}
	for serial, extra := range store.ExtraQuota {
		clone.ExtraQuota[serial] = extra
	}
	return clone
}

func SaveAIShareQuotaStore(path string, store AIShareQuotaStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.ExtraQuota == nil {
		store.ExtraQuota = map[string]int{}
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
	limit = store.ShareLimit(serial, limit)
	count := store.ShareCount(serial)
	if count >= limit {
		return fmt.Sprintf("每台设备最多分享 %d 次，您的额度已用完（已用 %d 次）", limit, count)
	}
	return ""
}

func (store AIShareQuotaStore) ExtraShareQuota(serial string) int {
	serial = strings.TrimSpace(serial)
	if serial == "" || store.ExtraQuota == nil {
		return 0
	}
	extra := store.ExtraQuota[serial]
	if extra < 0 {
		return 0
	}
	return extra
}

func (store AIShareQuotaStore) ShareLimit(serial string, baseLimit int) int {
	if baseLimit <= 0 {
		baseLimit = MaxAISharesPerDevice
	}
	return baseLimit + store.ExtraShareQuota(serial)
}

func (store AIShareQuotaStore) ShareRemaining(serial string, baseLimit int) int {
	return RemainingAIShares(store.ShareCount(serial), store.ShareLimit(serial, baseLimit))
}

func (store *AIShareQuotaStore) AddShareQuota(serial string, amount int) int {
	if store.ExtraQuota == nil {
		store.ExtraQuota = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" || amount <= 0 {
		return store.ExtraShareQuota(serial)
	}
	store.ExtraQuota[serial] = store.ExtraShareQuota(serial) + amount
	return store.ExtraQuota[serial]
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
