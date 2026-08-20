package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"strings"
	"time"
)

const MaxProfileAvatarBytes int64 = 512 * 1024

func NormalizeProfileAvatarContentType(contentType string) (string, string, error) {
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "image/jpeg", "image/jpg":
		return "image/jpeg", ".jpg", nil
	case "image/png":
		return "image/png", ".png", nil
	case "image/webp":
		return "image/webp", ".webp", nil
	default:
		return "", "", fmt.Errorf("unsupported avatar content type")
	}
}

func ProfileAvatarOwnerPrefix(serial string) string {
	hash := sha256.Sum256([]byte(strings.TrimSpace(serial)))
	return "avatars/" + hex.EncodeToString(hash[:12]) + "/"
}

func NewProfileAvatarObjectKey(serial, contentType string, now time.Time) (string, error) {
	_, ext, err := NormalizeProfileAvatarContentType(contentType)
	if err != nil {
		return "", err
	}
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%d-%s%s", ProfileAvatarOwnerPrefix(serial), now.UnixMilli(), hex.EncodeToString(random), ext), nil
}

func IsProfileAvatarObjectKeyOwnedBy(serial, objectKey string) bool {
	cleaned := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if cleaned == "" || path.Clean(cleaned) != cleaned {
		return false
	}
	return strings.HasPrefix(cleaned, ProfileAvatarOwnerPrefix(serial))
}
