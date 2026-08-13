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

	// The first call already consumed one of today's ten effective likes.
	for i := 1; i < CreditDailyActorLikeLimit; i++ {
		resourceID := fmt.Sprintf("r-%d", i)
		award, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", resourceID, now)
		if err != nil {
			t.Fatalf("cap fill failed: %v", err)
		}
		if !award.UploaderRewarded || !award.ActorRewarded {
			t.Fatalf("like %d should still reward both sides: %#v", i+1, award)
		}
	}
	// The 11th like still exists, but is not credit-effective for either side.
	capped, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", "cap-extra", now)
	if err != nil {
		t.Fatalf("capped award failed: %v", err)
	}
	if capped.UploaderRewarded || capped.ActorRewarded || !capped.DailyLimitReached {
		t.Fatalf("expected both rewards blocked by daily like limit, got %#v", capped)
	}

	// Beijing-time day rollover restores ten effective likes for this SN.
	tomorrow := now.Add(24 * time.Hour)
	nextDay, err := ApplyLikeCreditRewards(&credits, &grants, &daily, "UP", "LK", "next-day", tomorrow)
	if err != nil {
		t.Fatalf("next day award failed: %v", err)
	}
	if !nextDay.UploaderRewarded || !nextDay.ActorRewarded || nextDay.DailyLimitReached {
		t.Fatalf("expected rewards after day rollover, got %#v", nextDay)
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
