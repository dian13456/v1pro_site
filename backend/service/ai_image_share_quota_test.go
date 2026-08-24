package service

import "testing"

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
