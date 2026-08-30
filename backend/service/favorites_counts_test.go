package service

import "testing"

func TestAdjustFavoriteCount(t *testing.T) {
	store := NewEmptyFavoritesStore()
	if got := AdjustFavoriteCount(&store, "42", 1); got != 1 {
		t.Fatalf("expected 1, got %d", got)
	}
	if got := AdjustFavoriteCount(&store, "42", 1); got != 2 {
		t.Fatalf("expected 2, got %d", got)
	}
	if got := AdjustFavoriteCount(&store, "42", -1); got != 1 {
		t.Fatalf("expected 1, got %d", got)
	}
	if got := AdjustFavoriteCount(&store, "42", -5); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
}

func TestReconcileFavoriteCounts(t *testing.T) {
	store := FavoritesStore{
		Counts: map[string]int{},
		DeviceFavorites: map[string]map[string]int64{
			"SN1": {"1": 1, "2": 2},
			"SN2": {"1": 3},
		},
	}
	if !ReconcileFavoriteCounts(&store) {
		t.Fatal("expected reconcile to run")
	}
	if store.Counts["1"] != 2 || store.Counts["2"] != 1 {
		t.Fatalf("unexpected counts: %#v", store.Counts)
	}
	if ReconcileFavoriteCounts(&store) {
		t.Fatal("expected reconcile to skip when counts exist")
	}
}

func TestRemoveResourceFromAllFavoritesClearsCount(t *testing.T) {
	store := FavoritesStore{
		Counts: map[string]int{"9": 2},
		DeviceFavorites: map[string]map[string]int64{
			"SN1": {"9": 1},
			"SN2": {"9": 2},
		},
	}
	RemoveResourceFromAllFavorites(&store, "9")
	if len(store.DeviceFavorites["SN1"]) != 0 || len(store.DeviceFavorites["SN2"]) != 0 {
		t.Fatal("expected favorites removed")
	}
	if _, ok := store.Counts["9"]; ok {
		t.Fatal("expected count entry removed")
	}
}

func TestRemoveResourceAuxiliaryData(t *testing.T) {
	downloads := DownloadsStore{
		TotalCounts:  map[string]int{"9": 12, "10": 3},
		WeeklyCounts: map[string]int{"9": 4, "10": 1},
	}
	RemoveResourceFromDownloads(&downloads, "9")
	if _, ok := downloads.TotalCounts["9"]; ok {
		t.Fatal("expected total download count removed")
	}
	if _, ok := downloads.WeeklyCounts["9"]; ok {
		t.Fatal("expected weekly download count removed")
	}
	if downloads.TotalCounts["10"] != 3 {
		t.Fatal("unrelated download count changed")
	}

	messages := MessagesStore{Messages: []MessageEntry{
		{ID: "m1", ResourceID: "9"},
		{ID: "m2", ResourceID: "10"},
		{ID: "m3"},
	}}
	RemoveResourceMessages(&messages, "9")
	if len(messages.Messages) != 2 || messages.Messages[0].ID != "m2" || messages.Messages[1].ID != "m3" {
		t.Fatalf("unexpected messages after cleanup: %#v", messages.Messages)
	}

	grants := CreditLikeGrantStore{Grants: map[string]bool{
		"9|SN1": true, "9|SN2": true, "10|SN1": true,
	}}
	grants.RemoveResource("9")
	if len(grants.Grants) != 1 || !grants.Grants["10|SN1"] {
		t.Fatalf("unexpected grants after cleanup: %#v", grants.Grants)
	}
}
