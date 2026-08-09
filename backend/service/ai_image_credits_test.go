package service

import (
	"path/filepath"
	"testing"
)

func TestEnsureUnitScaleMigratesLegacyBalances(t *testing.T) {
	store := AICreditsStore{Balances: map[string]int{"SN1": 100}}
	if got := store.BalanceUnits("SN1"); got != 200 {
		t.Fatalf("expected 200 units after migrate, got %d", got)
	}
	if store.UnitScale != CreditUnitScale {
		t.Fatalf("expected unitScale=%d, got %d", CreditUnitScale, store.UnitScale)
	}
	if got := store.BalanceCredits("SN1"); got != 100 {
		t.Fatalf("expected 100 credits, got %v", got)
	}
}

func TestEarnHalfCreditUnits(t *testing.T) {
	store := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances:  map[string]int{"SN1": CreditsToUnits(10)},
	}
	next, err := store.EarnUnits("SN1", ActorLikeRewardUnits)
	if err != nil {
		t.Fatalf("earn failed: %v", err)
	}
	if next != CreditsToUnits(10)+1 {
		t.Fatalf("unexpected units %d", next)
	}
	if store.BalanceCredits("SN1") != 10.5 {
		t.Fatalf("expected 10.5 credits, got %v", store.BalanceCredits("SN1"))
	}
}

func TestLoadSaveCreditsPersistsUnitScale(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "credits.json")
	store := AICreditsStore{Balances: map[string]int{"SN1": 12}}
	if err := SaveAICreditsStore(path, store); err != nil {
		t.Fatalf("save failed: %v", err)
	}
	loaded, err := LoadAICreditsStore(path)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if loaded.UnitScale != CreditUnitScale {
		t.Fatalf("expected unitScale persisted, got %d", loaded.UnitScale)
	}
	if loaded.BalanceUnits("SN1") != 24 {
		t.Fatalf("expected migrated 24 units, got %d", loaded.BalanceUnits("SN1"))
	}
}
