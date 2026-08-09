package service

import (
	"fmt"
	"testing"
	"time"
)

func TestApplyLikeCreditRewardsLifetimeAndDailyCap(t *testing.T) {
	credits := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances: map[string]int{
			"UP": CreditsToUnits(10),
			"LK": CreditsToUnits(10),
		},
	}
	grants := NewCreditLikeGrantStore()
	daily := NewCreditDailyRewardStore()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.FixedZone("CST", 8*3600))

	first, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", "101", now)
	if err != nil {
		t.Fatalf("first award failed: %v", err)
	}
	if !first.UploaderRewarded || !first.ActorRewarded {
		t.Fatalf("expected both rewards, got %#v", first)
	}
	if credits.BalanceCredits("UP") != 11 || credits.BalanceCredits("LK") != 10.5 {
		t.Fatalf("unexpected balances up=%v liker=%v", credits.BalanceCredits("UP"), credits.BalanceCredits("LK"))
	}

	second, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", "101", now)
	if err != nil {
		t.Fatalf("second award failed: %v", err)
	}
	if second.UploaderRewarded || second.ActorRewarded {
		t.Fatalf("expected no re-award after cancel/re-like semantics, got %#v", second)
	}

	// Fill actor daily cap with unique resources.
	for i := 0; i < CreditDailyActorLikeCapUnits; i++ {
		resourceID := fmt.Sprintf("r-%d", i)
		if _, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", resourceID, now); err != nil {
			t.Fatalf("cap fill failed: %v", err)
		}
	}
	// One more should skip actor reward due to cap, but still reward uploader.
	capped, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", "cap-extra", now)
	if err != nil {
		t.Fatalf("capped award failed: %v", err)
	}
	if !capped.UploaderRewarded {
		t.Fatal("expected uploader reward under actor cap")
	}
	if capped.ActorRewarded {
		t.Fatal("expected actor reward blocked by daily cap")
	}
}

func TestApplyDownloadCreditRewardDedupeAndSelfSkip(t *testing.T) {
	credits := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances:  map[string]int{"UP": CreditsToUnits(5)},
	}
	daily := NewCreditDailyRewardStore()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.FixedZone("CST", 8*3600))

	self, err := ApplyDownloadCreditReward(&credits, &daily, "UP", "UP", "9", now)
	if err != nil {
		t.Fatalf("self download failed: %v", err)
	}
	if self.Rewarded {
		t.Fatal("self download should not reward")
	}

	first, err := ApplyDownloadCreditReward(&credits, &daily, "UP", "DL", "9", now)
	if err != nil {
		t.Fatalf("first download failed: %v", err)
	}
	if !first.Rewarded || credits.BalanceCredits("UP") != 5.5 {
		t.Fatalf("expected +0.5, got rewarded=%v balance=%v", first.Rewarded, credits.BalanceCredits("UP"))
	}

	again, err := ApplyDownloadCreditReward(&credits, &daily, "UP", "DL", "9", now)
	if err != nil {
		t.Fatalf("second download failed: %v", err)
	}
	if again.Rewarded {
		t.Fatal("same downloader+resource should reward once per day")
	}
}
