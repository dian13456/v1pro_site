package service

import "testing"

func TestApplyDeviceLikeInMemoryRollback(t *testing.T) {
	store := NewEmptyLikesStore()
	already, count := ApplyDeviceLikeInMemory(&store, "sn1", "1001")
	if already || count != 1 {
		t.Fatalf("first like failed: already=%v count=%d", already, count)
	}
	already, count = ApplyDeviceLikeInMemory(&store, "sn1", "1001")
	if !already || count != 1 {
		t.Fatalf("duplicate like failed: already=%v count=%d", already, count)
	}

	RollbackDeviceLikeInMemory(&store, "sn1", "1001")
	if store.Counts["1001"] != 0 {
		t.Fatalf("rollback should clear count, got %d", store.Counts["1001"])
	}
	if store.DeviceLikes["SN1"]["1001"] {
		t.Fatal("rollback should clear device like")
	}
}

func TestLikedResourceIDsNormalizesSerial(t *testing.T) {
	store := NewEmptyLikesStore()
	ApplyDeviceLikeInMemory(&store, "abc", "9")
	ids := LikedResourceIDsForSerial(&store, "ABC")
	if len(ids) != 1 || ids[0] != "9" {
		t.Fatalf("unexpected liked ids: %#v", ids)
	}
}
