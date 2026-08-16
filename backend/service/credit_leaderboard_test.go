package service

import "testing"

func TestBuildCreditLeaderboardRanksAndIncludesCurrent(t *testing.T) {
	credits := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances: map[string]int{
			"SN-A": CreditsToUnits(120),
			"SN-B": CreditsToUnits(110),
			"SN-C": CreditsToUnits(110),
		},
	}
	profiles := UserProfilesStore{Profiles: map[string]string{
		"SN-A": "阿甲",
		"SN-B": "阿乙",
		"SN-C": "阿丙",
		"SN-D": "当前用户",
	}}

	result := BuildCreditLeaderboard(credits, profiles, map[string]string{"SN-A": "往复循环"}, "SN-D", 3)
	if result.TotalUsers != 4 || len(result.Entries) != 3 {
		t.Fatalf("unexpected sizes: total=%d entries=%d", result.TotalUsers, len(result.Entries))
	}
	if result.Entries[0].Rank != 1 || result.Entries[1].Rank != 2 || result.Entries[2].Rank != 2 {
		t.Fatalf("unexpected shared ranks: %#v", result.Entries)
	}
	if result.Current.DisplayName != "当前用户" || result.Current.Rank != 4 || !result.Current.IsCurrent {
		t.Fatalf("unexpected current entry: %#v", result.Current)
	}
}

func TestBuildCreditLeaderboardDoesNotExposeSerial(t *testing.T) {
	result := BuildCreditLeaderboard(
		AICreditsStore{UnitScale: CreditUnitScale, Balances: map[string]int{}},
		UserProfilesStore{Profiles: map[string]string{}},
		nil,
		"SECRET-SERIAL-ABCD",
		50,
	)
	if len(result.Entries) != 1 || result.Entries[0].DisplayName == "SECRET-SERIAL-ABCD" {
		t.Fatalf("serial should be masked: %#v", result.Entries)
	}
}

func TestBuildCreditLeaderboardReturnsCreatorAndAvatar(t *testing.T) {
	result := BuildCreditLeaderboard(
		AICreditsStore{UnitScale: CreditUnitScale, Balances: map[string]int{"SN-A": CreditsToUnits(100)}},
		UserProfilesStore{
			Profiles: map[string]string{"SN-A": "该用户违规，已被注销"},
			Avatars:  map[string]string{"SN-A": "profile-avatars/sn-a/avatar.webp"},
		},
		map[string]string{"SN-A": "往复循环"},
		"SN-A",
		50,
	)
	entry := result.Entries[0]
	if entry.CreatorName != "往复循环" || entry.AvatarKey == "" {
		t.Fatalf("unexpected creator entry: %#v", entry)
	}
}
