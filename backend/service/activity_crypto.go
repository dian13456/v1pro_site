package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

func deriveActivityKey(secret string) []byte {
	sum := sha256.Sum256([]byte("jiadian-activity-pii:" + secret))
	return sum[:]
}

func EncryptActivityField(secret, plaintext string) (string, error) {
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" {
		return "", nil
	}
	key := deriveActivityKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func DecryptActivityField(secret, encoded string) (string, error) {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	key := deriveActivityKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func ValidateChinaMobilePhone(phone string) bool {
	phone = strings.TrimSpace(phone)
	if len(phone) != 11 {
		return false
	}
	if phone[0] != '1' {
		return false
	}
	for _, r := range phone {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func ValidateQQNumber(qq string) bool {
	qq = strings.TrimSpace(qq)
	if len(qq) < 5 || len(qq) > 12 {
		return false
	}
	if qq[0] == '0' {
		return false
	}
	for _, r := range qq {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func FormatFullAddress(province, city, address string) string {
	return fmt.Sprintf("%s %s %s", strings.TrimSpace(province), strings.TrimSpace(city), strings.TrimSpace(address))
}
