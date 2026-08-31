package service

import (
	"path/filepath"
	"testing"
)

func TestAddShareQuotaIncreasesLimitAndSurvivesClone(t *testing.T) {
	store := newAIShareQuotaStore()
	store.Counts["SN001"] = 45

	if got := store.AddShareQuota("SN001", 10); got != 10 {
		t.Fatalf("expected 10 extra shares, got %d", got)
	}
	if got := store.ShareLimit("SN001", MaxAISharesPerDevice); got != 60 {
		t.Fatalf("expected limit 60, got %d", got)
	}
	if got := store.ShareRemaining("SN001", MaxAISharesPerDevice); got != 15 {
		t.Fatalf("expected 15 remaining shares, got %d", got)
	}

	clone := store.Clone()
	store.AddShareQuota("SN001", 10)
	if got := clone.ExtraShareQuota("SN001"); got != 10 {
		t.Fatalf("clone must keep independent extra quota, got %d", got)
	}
}

func TestShareQuotaFieldsIncludesPurchasedQuota(t *testing.T) {
	store := newAIShareQuotaStore()
	store.Counts["SN001"] = 50
	store.ExtraQuota["SN001"] = 10
	fields := ShareQuotaFields(store, "SN001", NewAIShareUnlimitedStore())

	if fields["shareLimit"] != 60 {
		t.Fatalf("expected response limit 60, got %#v", fields["shareLimit"])
	}
	if fields["shareRemaining"] != 10 {
		t.Fatalf("expected response remaining 10, got %#v", fields["shareRemaining"])
	}
}

func TestResetShareRemainingToBasePreservesCountAndSetsExactlyFifty(t *testing.T) {
	store := newAIShareQuotaStore()
	store.Counts["SN001"] = 37
	store.ExtraQuota["SN001"] = 100

	if got := store.ResetShareRemainingToBase("SN001", MaxAISharesPerDevice); got != 50 {
		t.Fatalf("expected 50 remaining shares, got %d", got)
	}
	if got := store.ShareCount("SN001"); got != 37 {
		t.Fatalf("historical share count changed, got %d", got)
	}
	if got := store.ExtraShareQuota("SN001"); got != 37 {
		t.Fatalf("expected extra quota to match historical count, got %d", got)
	}
	if got := store.ShareLimit("SN001", MaxAISharesPerDevice); got != 87 {
		t.Fatalf("expected limit 87, got %d", got)
	}
}

func TestResetShareRemainingToBaseClearsUnusedExtraQuota(t *testing.T) {
	store := newAIShareQuotaStore()
	store.ExtraQuota["SN001"] = 25

	if got := store.ResetShareRemainingToBase("SN001", MaxAISharesPerDevice); got != 50 {
		t.Fatalf("expected 50 remaining shares, got %d", got)
	}
	if got := store.ExtraShareQuota("SN001"); got != 0 {
		t.Fatalf("expected stale extra quota to be cleared, got %d", got)
	}
}

func TestResetShareRemainingToBaseMergesLegacySerialCasing(t *testing.T) {
	store := newAIShareQuotaStore()
	store.Counts["sn001"] = 12
	store.Counts["SN001"] = 3
	store.ExtraQuota["Sn001"] = 80

	if got := store.ResetShareRemainingToBase("sN001", MaxAISharesPerDevice); got != 50 {
		t.Fatalf("expected 50 remaining shares, got %d", got)
	}
	if got := store.ShareCount("sn001"); got != 15 {
		t.Fatalf("expected merged historical count 15, got %d", got)
	}
	if got := store.ExtraShareQuota("SN001"); got != 15 {
		t.Fatalf("expected replacement extra quota 15, got %d", got)
	}
	if len(store.Counts) != 1 || len(store.ExtraQuota) != 1 {
		t.Fatalf("expected serial aliases to be consolidated, got %#v / %#v", store.Counts, store.ExtraQuota)
	}
}

func TestUserDataRepoResetAIShareRemainingToBasePersistsJSON(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	sharesPath := filepath.Join(t.TempDir(), "shares.json")
	repo, err := NewUserDataRepo(UserDataPaths{SharesPath: sharesPath})
	if err != nil {
		t.Fatal(err)
	}
	seed := newAIShareQuotaStore()
	seed.Counts["legacy-sn"] = 41
	seed.ExtraQuota["LEGACY-SN"] = 100
	if err := repo.SaveAIShareQuota(seed); err != nil {
		t.Fatal(err)
	}

	shareCount, err := repo.ResetAIShareRemainingToBase("Legacy-Sn", MaxAISharesPerDevice)
	if err != nil {
		t.Fatal(err)
	}
	if shareCount != 41 {
		t.Fatalf("expected historical count 41, got %d", shareCount)
	}
	persisted, err := repo.LoadAIShareQuota()
	if err != nil {
		t.Fatal(err)
	}
	if got := persisted.ShareCount("LEGACY-SN"); got != 41 {
		t.Fatalf("expected historical count 41 after reload, got %d", got)
	}
	if got := persisted.ShareRemaining("legacy-sn", MaxAISharesPerDevice); got != 50 {
		t.Fatalf("expected persisted remaining shares 50, got %d", got)
	}
}
