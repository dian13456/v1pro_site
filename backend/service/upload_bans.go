package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// UploadBan records an active administrator-enforced upload ban for one
// device.  Serial is always stored in its normalized (upper-case) form.
// Active bans are kept in UploadBanStore.Bans; unbanning removes the entry.
// Reason and AdminActor are optional audit metadata and are never exposed to
// the public resource catalog.
type UploadBan struct {
	Serial     string `json:"serial"`
	Reason     string `json:"reason,omitempty"`
	AdminActor string `json:"adminActor,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// UploadBanStore is the JSON representation used when STORAGE_BACKEND=json.
// The map key is the normalized uploader SN.  Keeping the key and Serial
// field both makes hand inspection convenient and lets us repair older files
// whose entries omitted Serial.
type UploadBanStore struct {
	Bans map[string]UploadBan `json:"bans"`
}

// NewEmptyUploadBanStore returns an initialized empty store.
func NewEmptyUploadBanStore() UploadBanStore {
	return UploadBanStore{Bans: map[string]UploadBan{}}
}

// NormalizeUploadBanSerial applies the same canonicalization used by the
// private catalog uploaderSerial field.  It is exported so callers that need
// to display/log a masked or normalized value do not duplicate rules.
func NormalizeUploadBanSerial(raw string) string {
	return normalizeUploaderSerial(raw)
}

// IsBanned reports whether serial has an active administrator ban.
func (s UploadBanStore) IsBanned(serial string) bool {
	target := normalizeUploaderSerial(serial)
	if target == "" || len(s.Bans) == 0 {
		return false
	}
	entry, ok := s.Bans[target]
	if !ok {
		// Be tolerant of hand-edited/legacy files with non-normalized keys.
		for key, candidate := range s.Bans {
			if normalizeUploaderSerial(key) == target {
				return candidate.Serial == "" || normalizeUploaderSerial(candidate.Serial) == target
			}
		}
		return false
	}
	return entry.Serial == "" || normalizeUploaderSerial(entry.Serial) == target
}

// Get returns metadata for an active ban.  The bool is false when serial is
// not banned.  Returned metadata is normalized and detached from the map.
func (s UploadBanStore) Get(serial string) (UploadBan, bool) {
	target := normalizeUploaderSerial(serial)
	if target == "" || len(s.Bans) == 0 {
		return UploadBan{}, false
	}
	entry, ok := s.Bans[target]
	if !ok {
		for key, candidate := range s.Bans {
			if normalizeUploaderSerial(key) == target {
				entry, ok = candidate, true
				break
			}
		}
	}
	if !ok {
		return UploadBan{}, false
	}
	entry.Serial = target
	return entry, true
}

// SetBanned updates one active ban and returns the resulting metadata.  A
// false value removes the active ban (idempotently).  This method only mutates
// an in-memory value; callers must persist it with SaveUploadBanStore.
func (s *UploadBanStore) SetBanned(serial string, banned bool, reason, adminActor string) (UploadBan, error) {
	if s == nil {
		return UploadBan{}, errors.New("上传封禁存储未配置")
	}
	target := normalizeUploaderSerial(serial)
	if target == "" {
		return UploadBan{}, errors.New("设备 SN 无效")
	}
	if s.Bans == nil {
		s.Bans = map[string]UploadBan{}
	}
	if !banned {
		for key := range s.Bans {
			if normalizeUploaderSerial(key) == target {
				delete(s.Bans, key)
			}
		}
		return UploadBan{Serial: target}, nil
	}
	now := time.Now().Unix()
	entry := s.Bans[target]
	if entry.CreatedAt <= 0 {
		entry.CreatedAt = now
	}
	entry.Serial = target
	entry.Reason = strings.TrimSpace(reason)
	entry.AdminActor = strings.TrimSpace(adminActor)
	entry.UpdatedAt = now
	s.Bans[target] = entry
	return entry, nil
}

// LoadUploadBanStore loads a JSON store.  A missing or empty file is treated
// as an empty store, matching the other UserDataRepo JSON stores.
func LoadUploadBanStore(path string) (UploadBanStore, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return UploadBanStore{}, errors.New("上传封禁存储路径未配置")
	}
	store := NewEmptyUploadBanStore()
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return store, nil
		}
		return UploadBanStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return store, nil
	}
	if err := json.Unmarshal(raw, &store); err != nil {
		return UploadBanStore{}, err
	}
	if store.Bans == nil {
		store.Bans = map[string]UploadBan{}
	}
	store = normalizeUploadBanStore(store)
	return store, nil
}

// SaveUploadBanStore atomically persists a JSON store.  The file is private
// (0600) because it contains device serial numbers and administrator metadata.
func SaveUploadBanStore(path string, store UploadBanStore) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("上传封禁存储路径未配置")
	}
	store = normalizeUploadBanStore(store)
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".upload-bans-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err == nil {
		return nil
	} else if runtime.GOOS != "windows" {
		return err
	}
	// Windows does not replace an existing destination with Rename.  Preserve
	// the previous file while replacing it, and restore it if replacement
	// fails.
	backupPath := tmpPath + ".previous"
	if renameErr := os.Rename(path, backupPath); renameErr != nil {
		return err
	}
	if replaceErr := os.Rename(tmpPath, path); replaceErr != nil {
		if restoreErr := os.Rename(backupPath, path); restoreErr != nil {
			return fmt.Errorf("替换上传封禁存储失败: %v；恢复旧文件失败: %v；旧文件保留在 %s", replaceErr, restoreErr, backupPath)
		}
		return replaceErr
	}
	_ = os.Remove(backupPath)
	return nil
}

func normalizeUploadBanStore(store UploadBanStore) UploadBanStore {
	result := NewEmptyUploadBanStore()
	for key, raw := range store.Bans {
		target := normalizeUploaderSerial(key)
		if target == "" {
			target = normalizeUploaderSerial(raw.Serial)
		}
		if target == "" {
			continue
		}
		raw.Serial = target
		raw.Reason = strings.TrimSpace(raw.Reason)
		raw.AdminActor = strings.TrimSpace(raw.AdminActor)
		if raw.UpdatedAt <= 0 {
			raw.UpdatedAt = raw.CreatedAt
		}
		if raw.CreatedAt <= 0 {
			raw.CreatedAt = raw.UpdatedAt
		}
		if existing, ok := result.Bans[target]; ok && existing.UpdatedAt > raw.UpdatedAt {
			continue
		}
		result.Bans[target] = raw
	}
	return result
}
