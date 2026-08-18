package service

import "testing"

func TestResolveDeviceFeatureAccess(t *testing.T) {
	legacy := ResolveDeviceFeatureAccess(DeviceRegistryEntry{CreatedAt: deviceFeatureAccessCutoff - 1})
	if !legacy.Enabled || !legacy.Grandfathered {
		t.Fatal("legacy device should be grandfathered")
	}
	newDevice := ResolveDeviceFeatureAccess(DeviceRegistryEntry{CreatedAt: deviceFeatureAccessCutoff})
	if newDevice.Enabled || newDevice.Grandfathered {
		t.Fatal("device registered at cutoff should require activation")
	}
	activated := ResolveDeviceFeatureAccess(DeviceRegistryEntry{CreatedAt: deviceFeatureAccessCutoff + 1, ActivatedAt: 1})
	if !activated.Enabled || activated.Grandfathered {
		t.Fatal("activated new device should be enabled without grandfathering")
	}
}

func TestValidDeviceFeatureActivationCode(t *testing.T) {
	t.Setenv("DEVICE_FEATURE_ACTIVATION_CODE", "")
	if !ValidDeviceFeatureActivationCode("1234") {
		t.Fatal("default activation code should be accepted")
	}
	if ValidDeviceFeatureActivationCode("0000") {
		t.Fatal("invalid activation code should be rejected")
	}
}
