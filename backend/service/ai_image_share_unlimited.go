package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type AIShareUnlimitedStore struct {
	serialSet map[string]struct{}
}

type aiShareUnlimitedJSON struct {
	Serials []string `json:"serials"`
}

func NewAIShareUnlimitedStore(serials ...string) AIShareUnlimitedStore {
	store := AIShareUnlimitedStore{serialSet: map[string]struct{}{}}
	for _, serial := range serials {
		store.add(normalizeShareSerial(serial))
	}
	return store
}

func normalizeShareSerial(serial string) string {
	return strings.ToUpper(strings.TrimSpace(serial))
}

func (store AIShareUnlimitedStore) cloneSet() map[string]struct{} {
	out := make(map[string]struct{}, len(store.serialSet))
	for serial := range store.serialSet {
		out[serial] = struct{}{}
	}
	return out
}

func (store AIShareUnlimitedStore) add(serial string) {
	serial = normalizeShareSerial(serial)
	if serial == "" || store.serialSet == nil {
		return
	}
	store.serialSet[serial] = struct{}{}
}

func (store AIShareUnlimitedStore) remove(serial string) {
	serial = normalizeShareSerial(serial)
	if serial == "" || store.serialSet == nil {
		return
	}
	delete(store.serialSet, serial)
}

func (store AIShareUnlimitedStore) Has(serial string) bool {
	serial = normalizeShareSerial(serial)
	if serial == "" || store.serialSet == nil {
		return false
	}
	_, ok := store.serialSet[serial]
	return ok
}

func (store AIShareUnlimitedStore) Serials() []string {
	if len(store.serialSet) == 0 {
		return nil
	}
	out := make([]string, 0, len(store.serialSet))
	for serial := range store.serialSet {
		out = append(out, serial)
	}
	sort.Strings(out)
	return out
}

func (store AIShareUnlimitedStore) With(serial string, enabled bool) AIShareUnlimitedStore {
	next := AIShareUnlimitedStore{serialSet: store.cloneSet()}
	if enabled {
		next.add(serial)
	} else {
		next.remove(serial)
	}
	return next
}

func LoadAIShareUnlimitedStore(path string) (AIShareUnlimitedStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return AIShareUnlimitedStore{serialSet: map[string]struct{}{}}, nil
		}
		return AIShareUnlimitedStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return AIShareUnlimitedStore{serialSet: map[string]struct{}{}}, nil
	}
	var payload aiShareUnlimitedJSON
	if err := json.Unmarshal(raw, &payload); err != nil {
		return AIShareUnlimitedStore{}, err
	}
	return NewAIShareUnlimitedStore(payload.Serials...), nil
}

func SaveAIShareUnlimitedStore(path string, store AIShareUnlimitedStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	payload := aiShareUnlimitedJSON{Serials: store.Serials()}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func TryReloadAIShareUnlimitedStore(path string, current *AIShareUnlimitedStore, lastMod *time.Time) error {
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
	latest, err := LoadAIShareUnlimitedStore(path)
	if err != nil {
		return err
	}
	*current = latest
	*lastMod = info.ModTime()
	return nil
}

func ShareLimitMessageWithUnlimited(
	quota AIShareQuotaStore,
	unlimited AIShareUnlimitedStore,
	serial string,
	limit int,
) string {
	if unlimited.Has(serial) {
		return ""
	}
	return quota.ShareLimitMessage(serial, limit)
}

func ShareQuotaFields(quota AIShareQuotaStore, serial string, unlimited AIShareUnlimitedStore) map[string]interface{} {
	count := quota.ShareCount(serial)
	fields := map[string]interface{}{
		"shareCount": count,
	}
	if unlimited.Has(serial) {
		fields["shareUnlimited"] = true
	} else {
		limit := quota.ShareLimit(serial, MaxAISharesPerDevice)
		fields["shareLimit"] = limit
		fields["shareRemaining"] = RemainingAIShares(count, limit)
	}
	return fields
}
