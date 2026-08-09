package service

import (
	"fmt"
	"strings"
	"time"
)

const (
	CreditDailyActorLikeCapUnits = 20 // 10 credits
	CreditDailyDownloadCapUnits  = 40 // 20 credits

	CreditRewardKindActorLike = "actor_like"
	CreditRewardKindDownload  = "download"
)

func ChinaNow(now time.Time) time.Time {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	return now.In(loc)
}

func ChinaDayKey(now time.Time) string {
	return ChinaNow(now).Format("2006-01-02")
}

func NormalizeRewardSerial(serial string) string {
	return strings.ToUpper(strings.TrimSpace(serial))
}

func ShouldAwardDownloadCredit(uploaderSerial, downloaderSerial string) bool {
	uploaderSerial = NormalizeRewardSerial(uploaderSerial)
	downloaderSerial = NormalizeRewardSerial(downloaderSerial)
	if uploaderSerial == "" || downloaderSerial == "" {
		return false
	}
	return uploaderSerial != downloaderSerial
}

type LikeCreditAwardResult struct {
	UploaderRewarded bool
	UploaderUnits    int
	ActorRewarded    bool
	ActorUnits       int
}

func (r LikeCreditAwardResult) UploaderCredits() float64 {
	return UnitsToCredits(r.UploaderUnits)
}

func (r LikeCreditAwardResult) ActorCredits() float64 {
	return UnitsToCredits(r.ActorUnits)
}

// ApplyLikeCreditRewards awards uploader +1 and liker +0.5 with lifetime/daily guards.
// Caller must persist credits/grants/daily stores and ledger entries when rewarded.
func ApplyLikeCreditRewards(
	credits *AICreditsStore,
	grants *CreditLikeGrantStore,
	daily *CreditDailyRewardStore,
	uploaderSerial, likerSerial, resourceID string,
	now time.Time,
) (LikeCreditAwardResult, error) {
	var result LikeCreditAwardResult
	if credits == nil || grants == nil || daily == nil {
		return result, fmt.Errorf("reward stores unavailable")
	}
	uploaderSerial = NormalizeRewardSerial(uploaderSerial)
	likerSerial = NormalizeRewardSerial(likerSerial)
	resourceID = strings.TrimSpace(resourceID)
	if !ShouldAwardLikeCredit(uploaderSerial, likerSerial) || resourceID == "" {
		return result, nil
	}
	if !grants.TryClaim(resourceID, likerSerial) {
		return result, nil
	}

	if next, err := credits.EarnUnits(uploaderSerial, UploaderLikeRewardUnits); err != nil {
		grants.Release(resourceID, likerSerial)
		return result, err
	} else {
		_ = next
		result.UploaderRewarded = true
		result.UploaderUnits = UploaderLikeRewardUnits
	}

	dayKey := ChinaDayKey(now)
	if daily.TryReserve(dayKey, CreditRewardKindActorLike, likerSerial, "", ActorLikeRewardUnits, CreditDailyActorLikeCapUnits) {
		if _, err := credits.EarnUnits(likerSerial, ActorLikeRewardUnits); err != nil {
			daily.Rollback(dayKey, CreditRewardKindActorLike, likerSerial, "", ActorLikeRewardUnits)
			return result, err
		}
		result.ActorRewarded = true
		result.ActorUnits = ActorLikeRewardUnits
	}
	return result, nil
}

type DownloadCreditAwardResult struct {
	Rewarded bool
	Units    int
}

func (r DownloadCreditAwardResult) Credits() float64 {
	return UnitsToCredits(r.Units)
}

// ApplyDownloadCreditReward awards uploader +0.5 with per-day dedupe and daily cap.
func ApplyDownloadCreditReward(
	credits *AICreditsStore,
	daily *CreditDailyRewardStore,
	uploaderSerial, downloaderSerial, resourceID string,
	now time.Time,
) (DownloadCreditAwardResult, error) {
	var result DownloadCreditAwardResult
	if credits == nil || daily == nil {
		return result, fmt.Errorf("reward stores unavailable")
	}
	uploaderSerial = NormalizeRewardSerial(uploaderSerial)
	downloaderSerial = NormalizeRewardSerial(downloaderSerial)
	resourceID = strings.TrimSpace(resourceID)
	if !ShouldAwardDownloadCredit(uploaderSerial, downloaderSerial) || resourceID == "" {
		return result, nil
	}
	dayKey := ChinaDayKey(now)
	if !daily.TryReserve(dayKey, CreditRewardKindDownload, uploaderSerial, downloadEventKey(downloaderSerial, resourceID), DownloadRewardUnits, CreditDailyDownloadCapUnits) {
		return result, nil
	}
	if _, err := credits.EarnUnits(uploaderSerial, DownloadRewardUnits); err != nil {
		daily.Rollback(dayKey, CreditRewardKindDownload, uploaderSerial, downloadEventKey(downloaderSerial, resourceID), DownloadRewardUnits)
		return result, err
	}
	result.Rewarded = true
	result.Units = DownloadRewardUnits
	return result, nil
}

func downloadEventKey(downloaderSerial, resourceID string) string {
	return NormalizeRewardSerial(downloaderSerial) + "|" + strings.TrimSpace(resourceID)
}
