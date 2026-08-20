package service

import (
	"crypto/subtle"
	"errors"
	"os"
	"strings"
	"time"
)

const defaultDeviceFeatureActivationCode = "1234"

var ErrInvalidDeviceFeatureActivationCode = errors.New("激活码不正确")

var deviceFeatureAccessCutoff = time.Date(2026, time.August, 18, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60)).UnixMilli()

type DeviceFeatureAccess struct {
	Enabled       bool  `json:"enabled"`
	Grandfathered bool  `json:"grandfathered"`
	RegisteredAt  int64 `json:"registeredAt"`
	ActivatedAt   int64 `json:"activatedAt,omitempty"`
}

func ResolveDeviceFeatureAccess(entry DeviceRegistryEntry) DeviceFeatureAccess {
	grandfathered := entry.CreatedAt > 0 && entry.CreatedAt < deviceFeatureAccessCutoff
	return DeviceFeatureAccess{
		Enabled:       grandfathered || entry.ActivatedAt > 0,
		Grandfathered: grandfathered,
		RegisteredAt:  entry.CreatedAt,
		ActivatedAt:   entry.ActivatedAt,
	}
}

func ValidDeviceFeatureActivationCode(input string) bool {
	expected := strings.TrimSpace(os.Getenv("DEVICE_FEATURE_ACTIVATION_CODE"))
	if expected == "" {
		expected = defaultDeviceFeatureActivationCode
	}
	actual := strings.TrimSpace(input)
	if len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func (s *ActivityService) GetDeviceFeatureAccess(serial string) (DeviceFeatureAccess, error) {
	sn := NormalizeSN(serial)
	entry, found, err := s.repo.GetDevice(sn)
	if err != nil {
		return DeviceFeatureAccess{}, err
	}
	if !found {
		if err := s.RegisterAuthenticatedDevice(sn, "feature-access"); err != nil {
			return DeviceFeatureAccess{}, err
		}
		entry, _, err = s.repo.GetDevice(sn)
		if err != nil {
			return DeviceFeatureAccess{}, err
		}
	}
	return ResolveDeviceFeatureAccess(entry), nil
}

func (s *ActivityService) ActivateDeviceFeatures(serial, code string) (DeviceFeatureAccess, error) {
	if !ValidDeviceFeatureActivationCode(code) {
		return DeviceFeatureAccess{}, ErrInvalidDeviceFeatureActivationCode
	}
	sn := NormalizeSN(serial)
	if _, err := s.GetDeviceFeatureAccess(sn); err != nil {
		return DeviceFeatureAccess{}, err
	}
	if err := s.repo.ActivateDeviceFeatures(sn, time.Now().UnixMilli()); err != nil {
		return DeviceFeatureAccess{}, err
	}
	return s.GetDeviceFeatureAccess(sn)
}
