package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type UserProfilesStore struct {
	Profiles map[string]string `json:"profiles"`
}

func LoadUserProfiles(path string) (UserProfilesStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return UserProfilesStore{Profiles: map[string]string{}}, nil
		}
		return UserProfilesStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return UserProfilesStore{Profiles: map[string]string{}}, nil
	}
	var store UserProfilesStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return UserProfilesStore{}, err
	}
	if store.Profiles == nil {
		store.Profiles = map[string]string{}
	}
	return store, nil
}

func SaveUserProfiles(path string, store UserProfilesStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Profiles == nil {
		store.Profiles = map[string]string{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func ResolveStoredDisplayName(store UserProfilesStore, serial, requested string) string {
	if name := strings.TrimSpace(requested); name != "" {
		return NormalizeDisplayName(serial, name)
	}
	if saved := strings.TrimSpace(store.Profiles[serial]); saved != "" {
		return NormalizeDisplayName(serial, saved)
	}
	return DisplayUsernameFromSerial(serial)
}

func SetStoredDisplayName(store *UserProfilesStore, serial, name string) string {
	if store.Profiles == nil {
		store.Profiles = map[string]string{}
	}
	normalized := NormalizeDisplayName(serial, name)
	if normalized == DisplayUsernameFromSerial(serial) {
		delete(store.Profiles, serial)
	} else {
		store.Profiles[serial] = normalized
	}
	return normalized
}
