package service

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestDecodeProfileAvatarAcceptsMatchingWebP(t *testing.T) {
	raw := []byte("RIFF\x04\x00\x00\x00WEBPdata")
	encoded := "data:image/webp;base64," + base64.StdEncoding.EncodeToString(raw)
	data, contentType, extension, err := DecodeProfileAvatar(encoded, "image/webp")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(raw) || contentType != "image/webp" || extension != ".webp" {
		t.Fatalf("unexpected result data=%q contentType=%q extension=%q", data, contentType, extension)
	}
}

func TestDecodeProfileAvatarRejectsTypeMismatchAndOversize(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("payload")...)
	encoded := base64.StdEncoding.EncodeToString(png)
	if _, _, _, err := DecodeProfileAvatar(encoded, "image/jpeg"); err == nil {
		t.Fatal("expected content type mismatch")
	}
	oversized := base64.StdEncoding.EncodeToString(make([]byte, MaxProfileAvatarBytes+1))
	if _, _, _, err := DecodeProfileAvatar(oversized, "image/png"); err == nil {
		t.Fatal("expected oversized avatar rejection")
	}
}

func TestProfileAvatarObjectKeyDoesNotExposeSerial(t *testing.T) {
	key := ProfileAvatarObjectKey("SECRET-SERIAL-123", ".png", time.Unix(123, 0))
	if strings.Contains(key, "SECRET-SERIAL-123") || !strings.HasPrefix(key, "profile-avatars/") || !strings.HasSuffix(key, ".png") {
		t.Fatalf("unexpected object key: %q", key)
	}
}

func TestUserProfilesPersistAvatarAndResolveCreator(t *testing.T) {
	path := t.TempDir() + "/profiles.json"
	store := UserProfilesStore{
		Profiles: map[string]string{"SN-ONE": "喵喵作者"},
		Avatars:  map[string]string{"SN-ONE": "profile-avatars/key.webp"},
	}
	if err := SaveUserProfiles(path, store); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadUserProfiles(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Avatars["SN-ONE"] != "profile-avatars/key.webp" {
		t.Fatalf("avatar was not persisted: %#v", loaded.Avatars)
	}
	if got := FindProfileSerialByDisplayName(loaded, "喵喵作者"); got != "SN-ONE" {
		t.Fatalf("resolved serial=%q", got)
	}
}
