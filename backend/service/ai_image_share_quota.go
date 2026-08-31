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
	return store.Clone(), nil
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
		serial = normalizeAIShareQuotaSerial(serial)
		if serial != "" && count > 0 {
			clone.Counts[serial] += count
		}
	}
	for serial, extra := range store.ExtraQuota {
		serial = normalizeAIShareQuotaSerial(serial)
		if serial != "" && extra > 0 {
			clone.ExtraQuota[serial] += extra
		}
	}
	return clone
}

func SaveAIShareQuotaStore(path string, store AIShareQuotaStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	store = store.Clone()
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
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" || store.Counts == nil {
		return 0
	}
	count := 0
	for key, value := range store.Counts {
		if normalizeAIShareQuotaSerial(key) == serial && value > 0 {
			count += value
		}
	}
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
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" || store.ExtraQuota == nil {
		return 0
	}
	extra := 0
	for key, value := range store.ExtraQuota {
		if normalizeAIShareQuotaSerial(key) == serial && value > 0 {
			extra += value
		}
	}
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
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" || amount <= 0 {
		return store.ExtraShareQuota(serial)
	}
	current := store.ExtraShareQuota(serial)
	deleteAIShareQuotaAliases(store.ExtraQuota, serial)
	store.ExtraQuota[serial] = current + amount
	return store.ExtraQuota[serial]
}

// ResetShareRemainingToBase preserves the historical share count while making
// the device's remaining upload allowance equal to the base limit again.
func (store *AIShareQuotaStore) ResetShareRemainingToBase(serial string, baseLimit int) int {
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" {
		return 0
	}
	if baseLimit <= 0 {
		baseLimit = MaxAISharesPerDevice
	}
	if store.ExtraQuota == nil {
		store.ExtraQuota = map[string]int{}
	}
	count := store.ShareCount(serial)
	// limit = base + extra, so extra=count yields exactly base shares left.
	store.SetShareQuota(serial, count, count)
	return store.ShareRemaining(serial, baseLimit)
}

// SetShareQuota replaces one device's quota values and removes legacy aliases
// that differ only by whitespace or character casing.
func (store *AIShareQuotaStore) SetShareQuota(serial string, count, extra int) {
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" {
		return
	}
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	if store.ExtraQuota == nil {
		store.ExtraQuota = map[string]int{}
	}
	deleteAIShareQuotaAliases(store.Counts, serial)
	deleteAIShareQuotaAliases(store.ExtraQuota, serial)
	if count > 0 {
		store.Counts[serial] = count
	}
	if extra > 0 {
		store.ExtraQuota[serial] = extra
	}
}

func (store *AIShareQuotaStore) RecordShare(serial string) int {
	if store.Counts == nil {
		store.Counts = map[string]int{}
	}
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" {
		return 0
	}
	current := store.ShareCount(serial)
	deleteAIShareQuotaAliases(store.Counts, serial)
	store.Counts[serial] = current + 1
	return store.Counts[serial]
}

func normalizeAIShareQuotaSerial(serial string) string {
	return strings.ToUpper(strings.TrimSpace(serial))
}

func deleteAIShareQuotaAliases(values map[string]int, serial string) {
	serial = normalizeAIShareQuotaSerial(serial)
	for key := range values {
		if normalizeAIShareQuotaSerial(key) == serial {
			delete(values, key)
		}
	}
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
