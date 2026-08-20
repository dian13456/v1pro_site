package service

import "testing"

func TestBuildCreditLeaderboardRanksAndProtectsDefaultName(t *testing.T) {
	credits := AICreditsStore{UnitScale: CreditUnitScale, Balances: map[string]int{
		"SN-A": CreditsToUnits(120),
		"SN-B": CreditsToUnits(120),
		"SN-C": CreditsToUnits(90),
	}}
	profiles := UserProfilesStore{
		Profiles: map[string]string{"SN-A": "小橙"},
		Avatars:  map[string]string{"SN-B": "avatars/b.webp"},
	}
	creatorNames := map[string]string{
		"SN-A": "往复循环",
		"SN-C": "素材作者",
	}
	rows, current, total := BuildCreditLeaderboard(credits, profiles, creatorNames, "SN-C", 50)
	if total != 3 {
		t.Fatalf("unexpected total: %d", total)
	}
	if len(rows) != 3 || rows[0].Rank != 1 || rows[1].Rank != 1 || rows[2].Rank != 3 {
		t.Fatalf("unexpected ranking: %#v", rows)
	}
	foundProtectedName := false
	for _, row := range rows {
		if row.AvatarKey == "avatars/b.webp" && row.DisplayName == "佳点用户" {
			foundProtectedName = true
		}
	}
	if !foundProtectedName {
		t.Fatalf("default name should not expose serial suffix: %#v", rows)
	}
	if current == nil || current.Rank != 3 || !current.IsCurrent {
		t.Fatalf("unexpected current entry: %#v", current)
	}
	if current.CreatorName != "素材作者" {
		t.Fatalf("creator name should resolve to the material author: %q", current.CreatorName)
	}
}
