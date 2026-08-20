package service

import "testing"

func TestUpdateWinnerShippingStoresTrackingNumber(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	configDir := t.TempDir()
	repo, err := NewActivityRepo(configDir)
	if err != nil {
		t.Fatal(err)
	}
	winner := Winner{
		ID:             "winner-tracking-test",
		ActivityID:     DefaultActivity().ID,
		JoinID:         "join-tracking-test",
		SN:             "E339E339TESTABCD",
		UserSerial:     "USER-TRACKING-TEST",
		WinnerTime:     1786878008206,
		ContactStatus:  ContactStatusFilled,
		ShippingStatus: ShippingStatusPending,
		DrawPeriod:     "2026-08-16",
	}
	if err := repo.AddWinner(winner); err != nil {
		t.Fatal(err)
	}
	const trackingNo = "中通快递-79026125454059"
	if err := repo.UpdateWinnerShipping(winner.ID, ShippingStatusShipped, trackingNo); err != nil {
		t.Fatal(err)
	}

	stored, ok, err := repo.GetWinner(winner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("winner not found")
	}
	if stored.ShippingStatus != ShippingStatusShipped {
		t.Fatalf("shipping status = %q", stored.ShippingStatus)
	}
	if stored.TrackingNo != trackingNo {
		t.Fatalf("tracking number = %q", stored.TrackingNo)
	}
}

func TestUpdateWinnerShippingBlankTrackingNumberPreservesExisting(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewActivityRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	winner := Winner{
		ID:             "winner-preserve-tracking-test",
		ActivityID:     DefaultActivity().ID,
		JoinID:         "join-preserve-tracking-test",
		SN:             "E339E339PRESERVEABCD",
		UserSerial:     "USER-PRESERVE-TRACKING-TEST",
		WinnerTime:     1786878008206,
		ContactStatus:  ContactStatusFilled,
		ShippingStatus: ShippingStatusPending,
		TrackingNo:     "SF1234567890",
		DrawPeriod:     "2026-08-16",
	}
	if err := repo.AddWinner(winner); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateWinnerShipping(winner.ID, ShippingStatusShipped, "  "); err != nil {
		t.Fatal(err)
	}

	stored, ok, err := repo.GetWinner(winner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("winner not found")
	}
	if stored.ShippingStatus != ShippingStatusShipped {
		t.Fatalf("shipping status = %q", stored.ShippingStatus)
	}
	if stored.TrackingNo != winner.TrackingNo {
		t.Fatalf("tracking number was overwritten: %q", stored.TrackingNo)
	}
}
