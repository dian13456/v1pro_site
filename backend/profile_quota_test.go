package main

import (
	"testing"

	"jiadian-hub-backend/service"
)

func TestProfileShareQuotaFieldsForLimitedUploader(t *testing.T) {
	quota := service.AIShareQuotaStore{
		Counts:     map[string]int{},
		ExtraQuota: map[string]int{},
	}
	quota.Counts["sn001"] = 7
	quota.ExtraQuota["SN001"] = 3
	fields := profileShareQuotaFields(quota, " SN001 ", service.NewAIShareUnlimitedStore())

	if fields["shareCount"] != 7 {
		t.Fatalf("shareCount=%#v, want 7", fields["shareCount"])
	}
	if fields["shareLimit"] != 53 {
		t.Fatalf("shareLimit=%#v, want 53", fields["shareLimit"])
	}
	if fields["shareRemaining"] != 46 {
		t.Fatalf("shareRemaining=%#v, want 46", fields["shareRemaining"])
	}
	if fields["shareUnlimited"] != false {
		t.Fatalf("shareUnlimited=%#v, want false", fields["shareUnlimited"])
	}
}

func TestProfileShareQuotaFieldsForUnlimitedUploader(t *testing.T) {
	quota := service.AIShareQuotaStore{
		Counts:     map[string]int{},
		ExtraQuota: map[string]int{},
	}
	quota.Counts["SN001"] = 12
	unlimited := service.NewAIShareUnlimitedStore("SN001")
	fields := profileShareQuotaFields(quota, "SN001", unlimited)

	if fields["shareCount"] != 12 {
		t.Fatalf("shareCount=%#v, want 12", fields["shareCount"])
	}
	if fields["shareUnlimited"] != true {
		t.Fatalf("shareUnlimited=%#v, want true", fields["shareUnlimited"])
	}
	if value, ok := fields["shareLimit"]; !ok || value != nil {
		t.Fatalf("shareLimit=%#v, want explicit null", value)
	}
	if value, ok := fields["shareRemaining"]; !ok || value != nil {
		t.Fatalf("shareRemaining=%#v, want explicit null", value)
	}
}
