package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type CreditLikeGrantStore struct {
	Grants map[string]bool `json:"grants"`
}

func NewCreditLikeGrantStore() CreditLikeGrantStore {
	return CreditLikeGrantStore{Grants: map[string]bool{}}
}

func likeGrantKey(resourceID, likerSerial string) string {
	return strings.TrimSpace(resourceID) + "|" + NormalizeRewardSerial(likerSerial)
}

func LoadCreditLikeGrantStore(path string) (CreditLikeGrantStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return NewCreditLikeGrantStore(), nil
		}
		return CreditLikeGrantStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return NewCreditLikeGrantStore(), nil
	}
	var store CreditLikeGrantStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return CreditLikeGrantStore{}, err
	}
	if store.Grants == nil {
		store.Grants = map[string]bool{}
	}
	return store, nil
}

func SaveCreditLikeGrantStore(path string, store CreditLikeGrantStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Grants == nil {
		store.Grants = map[string]bool{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func (store *CreditLikeGrantStore) Has(resourceID, likerSerial string) bool {
	if store == nil {
		return false
	}
	if store.Grants == nil {
		return false
	}
	return store.Grants[likeGrantKey(resourceID, likerSerial)]
}

func (store *CreditLikeGrantStore) TryClaim(resourceID, likerSerial string) bool {
	if store == nil {
		return false
	}
	if store.Grants == nil {
		store.Grants = map[string]bool{}
	}
	key := likeGrantKey(resourceID, likerSerial)
	if key == "|" || strings.HasPrefix(key, "|") || strings.HasSuffix(key, "|") {
		return false
	}
	if store.Grants[key] {
		return false
	}
	store.Grants[key] = true
	return true
}

func (store *CreditLikeGrantStore) Release(resourceID, likerSerial string) {
	if store == nil || store.Grants == nil {
		return
	}
	delete(store.Grants, likeGrantKey(resourceID, likerSerial))
}

func DefaultCreditLikeGrantsPath(configDir string) string {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	return filepath.Join(configDir, "credit_like_grants.json")
}
