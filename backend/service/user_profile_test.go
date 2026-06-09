package service

import "testing"

func TestDisplayNameTakenByOther(t *testing.T) {
	store := UserProfilesStore{
		Profiles: map[string]string{
			"SN-A": "小明",
			"SN-B": "Alice",
		},
	}

	if !DisplayNameTakenByOther(store, "SN-C", "小明") {
		t.Fatal("expected 小明 to be taken")
	}
	if DisplayNameTakenByOther(store, "SN-A", "小明") {
		t.Fatal("own name should not count as taken")
	}
	if !DisplayNameTakenByOther(store, "SN-C", "alice") {
		t.Fatal("expected case-insensitive match")
	}
	if DisplayNameTakenByOther(store, "SN-C", "全新昵称") {
		t.Fatal("expected unique name to be available")
	}
}

func TestSetStoredDisplayNameRejectsDuplicate(t *testing.T) {
	store := UserProfilesStore{
		Profiles: map[string]string{
			"SN-A": "TakenName",
		},
	}

	_, err := SetStoredDisplayName(&store, "SN-B", "TakenName")
	if err != ErrDisplayNameTaken {
		t.Fatalf("expected ErrDisplayNameTaken, got %v", err)
	}

	name, err := SetStoredDisplayName(&store, "SN-B", "UniqueName")
	if err != nil || name != "UniqueName" {
		t.Fatalf("expected unique save, got name=%q err=%v", name, err)
	}
	if store.Profiles["SN-B"] != "UniqueName" {
		t.Fatal("profile not stored")
	}
}

func TestSetStoredDisplayNameAllowsDefault(t *testing.T) {
	store := UserProfilesStore{
		Profiles: map[string]string{
			"SN-LONG-SERIAL-001": "Custom",
		},
	}

	name, err := SetStoredDisplayName(&store, "SN-LONG-SERIAL-001", "")
	if err != nil {
		t.Fatalf("reset to default failed: %v", err)
	}
	expected := DisplayUsernameFromSerial("SN-LONG-SERIAL-001")
	if name != expected {
		t.Fatalf("expected default %q, got %q", expected, name)
	}
	if _, ok := store.Profiles["SN-LONG-SERIAL-001"]; ok {
		t.Fatal("custom profile entry should be removed")
	}
}
