package service

import (
	"sort"
	"strings"
)

type CreditLeaderboardEntry struct {
	Rank        int
	DisplayName string
	CreatorName string
	Credits     float64
	AvatarKey   string
	IsCurrent   bool
	serial      string
}

func BuildCreditLeaderboard(
	credits AICreditsStore,
	profiles UserProfilesStore,
	creatorNames map[string]string,
	currentSerial string,
	limit int,
) ([]CreditLeaderboardEntry, *CreditLeaderboardEntry, int) {
	if limit <= 0 {
		limit = 50
	}
	serials := map[string]struct{}{}
	for serial := range credits.Balances {
		serials[strings.TrimSpace(serial)] = struct{}{}
	}
	for serial := range profiles.Profiles {
		serials[strings.TrimSpace(serial)] = struct{}{}
	}
	for serial := range profiles.Avatars {
		serials[strings.TrimSpace(serial)] = struct{}{}
	}
	currentSerial = strings.TrimSpace(currentSerial)
	if currentSerial != "" {
		serials[currentSerial] = struct{}{}
	}
	delete(serials, "")

	all := make([]CreditLeaderboardEntry, 0, len(serials))
	for serial := range serials {
		displayName := strings.TrimSpace(profiles.Profiles[serial])
		if displayName == "" {
			displayName = "佳点用户"
		}
		creatorName := strings.TrimSpace(creatorNames[serial])
		if creatorName == "" {
			creatorName = ResolveStoredDisplayName(profiles, serial, "")
		}
		all = append(all, CreditLeaderboardEntry{
			DisplayName: displayName,
			CreatorName: creatorName,
			Credits:     credits.BalanceCredits(serial),
			AvatarKey:   strings.TrimSpace(profiles.Avatars[serial]),
			IsCurrent:   serial == currentSerial,
			serial:      serial,
		})
	}

	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Credits != all[j].Credits {
			return all[i].Credits > all[j].Credits
		}
		if all[i].DisplayName != all[j].DisplayName {
			return all[i].DisplayName < all[j].DisplayName
		}
		return all[i].serial < all[j].serial
	})

	rank := 0
	var previousCredits float64
	var current *CreditLeaderboardEntry
	for index := range all {
		if index == 0 || all[index].Credits != previousCredits {
			rank = index + 1
			previousCredits = all[index].Credits
		}
		all[index].Rank = rank
		if all[index].IsCurrent {
			copyOfCurrent := all[index]
			current = &copyOfCurrent
		}
	}

	if len(all) > limit {
		all = all[:limit]
	}
	return all, current, len(serials)
}
