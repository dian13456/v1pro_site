package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var ErrDisplayNameTaken = errors.New("display name already taken")

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

func DisplayNameTakenByOther(store UserProfilesStore, serial, normalized string) bool {
	target := strings.TrimSpace(normalized)
	if target == "" {
		return false
	}
	for otherSerial, otherName := range store.Profiles {
		if otherSerial == serial {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(otherName), target) {
			return true
		}
	}
	return false
}

func SetStoredDisplayName(store *UserProfilesStore, serial, name string) (string, error) {
	if store.Profiles == nil {
		store.Profiles = map[string]string{}
	}
	normalized := NormalizeDisplayName(serial, name)
	if normalized == DisplayUsernameFromSerial(serial) {
		delete(store.Profiles, serial)
		return normalized, nil
	}
	if DisplayNameTakenByOther(*store, serial, normalized) {
		return "", ErrDisplayNameTaken
	}
	store.Profiles[serial] = normalized
	return normalized, nil
}
