package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type CreditDailyRewardStore struct {
	DayKey string          `json:"dayKey"`
	Events map[string]bool `json:"events"`
	Totals map[string]int  `json:"totals"`
}

func NewCreditDailyRewardStore() CreditDailyRewardStore {
	return CreditDailyRewardStore{
		Events: map[string]bool{},
		Totals: map[string]int{},
	}
}

func LoadCreditDailyRewardStore(path string) (CreditDailyRewardStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return NewCreditDailyRewardStore(), nil
		}
		return CreditDailyRewardStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return NewCreditDailyRewardStore(), nil
	}
	var store CreditDailyRewardStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return CreditDailyRewardStore{}, err
	}
	if store.Events == nil {
		store.Events = map[string]bool{}
	}
	if store.Totals == nil {
		store.Totals = map[string]int{}
	}
	return store, nil
}

func SaveCreditDailyRewardStore(path string, store CreditDailyRewardStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Events == nil {
		store.Events = map[string]bool{}
	}
	if store.Totals == nil {
		store.Totals = map[string]int{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func (store *CreditDailyRewardStore) ensureDay(dayKey string) {
	dayKey = strings.TrimSpace(dayKey)
	if store.DayKey == dayKey {
		if store.Events == nil {
			store.Events = map[string]bool{}
		}
		if store.Totals == nil {
			store.Totals = map[string]int{}
		}
		return
	}
	store.DayKey = dayKey
	store.Events = map[string]bool{}
	store.Totals = map[string]int{}
}

func dailyTotalKey(kind, beneficiarySerial string) string {
	return strings.TrimSpace(kind) + "|" + NormalizeRewardSerial(beneficiarySerial)
}

func dailyEventKey(kind, eventID string) string {
	return strings.TrimSpace(kind) + "|" + strings.TrimSpace(eventID)
}

// TryReserve reserves amountUnits under a daily cap.
// eventID empty means "no event dedupe, only cap" (used by actor like).
func (store *CreditDailyRewardStore) TryReserve(dayKey, kind, beneficiarySerial, eventID string, amountUnits, capUnits int) bool {
	if store == nil || amountUnits <= 0 || capUnits <= 0 {
		return false
	}
	beneficiarySerial = NormalizeRewardSerial(beneficiarySerial)
	if beneficiarySerial == "" || strings.TrimSpace(kind) == "" {
		return false
	}
	store.ensureDay(dayKey)
	if eventID = strings.TrimSpace(eventID); eventID != "" {
		ek := dailyEventKey(kind, eventID)
		if store.Events[ek] {
			return false
		}
	}
	tk := dailyTotalKey(kind, beneficiarySerial)
	if store.Totals[tk]+amountUnits > capUnits {
		return false
	}
	if eventID != "" {
		store.Events[dailyEventKey(kind, eventID)] = true
	}
	store.Totals[tk] += amountUnits
	return true
}

func (store *CreditDailyRewardStore) Rollback(dayKey, kind, beneficiarySerial, eventID string, amountUnits int) {
	if store == nil || amountUnits <= 0 {
		return
	}
	if strings.TrimSpace(store.DayKey) != strings.TrimSpace(dayKey) {
		return
	}
	tk := dailyTotalKey(kind, beneficiarySerial)
	next := store.Totals[tk] - amountUnits
	if next <= 0 {
		delete(store.Totals, tk)
	} else {
		store.Totals[tk] = next
	}
	if eventID = strings.TrimSpace(eventID); eventID != "" {
		delete(store.Events, dailyEventKey(kind, eventID))
	}
}

func DefaultCreditDailyRewardsPath(configDir string) string {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	return filepath.Join(configDir, "credit_daily_rewards.json")
}
