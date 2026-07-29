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
