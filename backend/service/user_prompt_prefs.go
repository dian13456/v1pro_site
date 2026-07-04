package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type UserPromptPrefsStore struct {
	SoftwareDismissed map[string]int64 `json:"softwareDismissed"`
}

func LoadUserPromptPrefs(path string) (UserPromptPrefsStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return UserPromptPrefsStore{SoftwareDismissed: map[string]int64{}}, nil
		}
		return UserPromptPrefsStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return UserPromptPrefsStore{SoftwareDismissed: map[string]int64{}}, nil
	}
	var store UserPromptPrefsStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return UserPromptPrefsStore{}, err
	}
	if store.SoftwareDismissed == nil {
		store.SoftwareDismissed = map[string]int64{}
	}
	return store, nil
}

func SaveUserPromptPrefs(path string, store UserPromptPrefsStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.SoftwareDismissed == nil {
		store.SoftwareDismissed = map[string]int64{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func GetSoftwarePromptDismissedID(store UserPromptPrefsStore, serial string) int64 {
	serial = strings.TrimSpace(serial)
	if serial == "" || store.SoftwareDismissed == nil {
		return 0
	}
	return store.SoftwareDismissed[serial]
}

func SetSoftwarePromptDismissedID(store *UserPromptPrefsStore, serial string, resourceID int64) int64 {
	if store.SoftwareDismissed == nil {
		store.SoftwareDismissed = map[string]int64{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" || resourceID <= 0 {
		return 0
	}
	store.SoftwareDismissed[serial] = resourceID
	return resourceID
}

func ParseSoftwarePromptResourceID(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}
