package service

import (
	"sort"
	"strings"
)

type CreditLeaderboardEntry struct {
	Rank        int     `json:"rank"`
	DisplayName string  `json:"displayName"`
	CreatorName string  `json:"creatorName,omitempty"`
	Credits     float64 `json:"credits"`
	IsCurrent   bool    `json:"isCurrent,omitempty"`
	AvatarKey   string  `json:"-"`
}

type CreditLeaderboardResult struct {
	Entries    []CreditLeaderboardEntry `json:"entries"`
	Current    CreditLeaderboardEntry   `json:"current"`
	TotalUsers int                      `json:"totalUsers"`
}

type creditLeaderboardCandidate struct {
	serial      string
	displayName string
	credits     float64
}

// BuildCreditLeaderboard builds a privacy-safe ranking without exposing device
// serial numbers. Accounts with an explicitly stored credit balance participate;
// the requesting account is always included so its current rank is available.
func BuildCreditLeaderboard(
	credits AICreditsStore,
	profiles UserProfilesStore,
	creatorNames map[string]string,
	currentSerial string,
	limit int,
) CreditLeaderboardResult {
	currentSerial = strings.TrimSpace(currentSerial)
	serials := make(map[string]struct{}, len(credits.Balances)+1)
	for serial := range credits.Balances {
		if serial = strings.TrimSpace(serial); serial != "" {
			serials[serial] = struct{}{}
		}
	}
	if currentSerial != "" {
		serials[currentSerial] = struct{}{}
	}

	candidates := make([]creditLeaderboardCandidate, 0, len(serials))
	for serial := range serials {
		name := ResolveStoredDisplayName(profiles, serial, "")
		candidates = append(candidates, creditLeaderboardCandidate{
			serial:      serial,
			displayName: name,
			credits:     credits.BalanceCredits(serial),
		})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].credits != candidates[j].credits {
			return candidates[i].credits > candidates[j].credits
		}
		if candidates[i].displayName != candidates[j].displayName {
			return candidates[i].displayName < candidates[j].displayName
		}
		return candidates[i].serial < candidates[j].serial
	})

	allEntries := make([]CreditLeaderboardEntry, 0, len(candidates))
	previousCredits := -1.0
	previousRank := 0
	for index, candidate := range candidates {
		rank := index + 1
		if index > 0 && candidate.credits == previousCredits {
			rank = previousRank
		}
		entry := CreditLeaderboardEntry{
			Rank:        rank,
			DisplayName: candidate.displayName,
			CreatorName: strings.TrimSpace(creatorNames[candidate.serial]),
			Credits:     candidate.credits,
			IsCurrent:   candidate.serial == currentSerial,
			AvatarKey:   strings.TrimSpace(profiles.Avatars[candidate.serial]),
		}
		if entry.CreatorName == "" {
			entry.CreatorName = candidate.displayName
		}
		allEntries = append(allEntries, entry)
		previousCredits = candidate.credits
		previousRank = rank
	}

	current := CreditLeaderboardEntry{}
	for _, entry := range allEntries {
		if entry.IsCurrent {
			current = entry
			break
		}
	}
	if limit <= 0 || limit > len(allEntries) {
		limit = len(allEntries)
	}
	entries := append([]CreditLeaderboardEntry(nil), allEntries[:limit]...)
	if entries == nil {
		entries = []CreditLeaderboardEntry{}
	}
	return CreditLeaderboardResult{Entries: entries, Current: current, TotalUsers: len(allEntries)}
}
