package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultAICredits          = 100
	AICreditCostPerGeneration = 1
	LikeCreditRewardAmount    = 1

	CreditUnitScale                 = 2
	DefaultAICreditUnits            = DefaultAICredits * CreditUnitScale
	AICreditCostPerGenerationUnits  = AICreditCostPerGeneration * CreditUnitScale
	UploaderLikeRewardUnits         = 2
	ActorLikeRewardUnits            = 1
	DownloadRewardUnits             = 1
)

type AICreditsStore struct {
	UnitScale int            `json:"unitScale"`
	Balances  map[string]int `json:"balances"`
}

func LoadAICreditsStore(path string) (AICreditsStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return newAICreditsStore(), nil
		}
		return AICreditsStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return newAICreditsStore(), nil
	}
	var store AICreditsStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return AICreditsStore{}, err
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	store.ensureUnitScale()
	return store, nil
}

func SaveAICreditsStore(path string, store AICreditsStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	store.ensureUnitScale()
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func newAICreditsStore() AICreditsStore {
	return AICreditsStore{UnitScale: CreditUnitScale, Balances: map[string]int{}}
}

// ensureUnitScale upgrades legacy whole-credit balances exactly once.
func (store *AICreditsStore) ensureUnitScale() {
	if store.UnitScale == CreditUnitScale {
		return
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	for serial, balance := range store.Balances {
		store.Balances[serial] = balance * CreditUnitScale
	}
	store.UnitScale = CreditUnitScale
}

func CreditsToUnits(credits int) int {
	return credits * CreditUnitScale
}

func UnitsToCredits(units int) float64 {
	return float64(units) / float64(CreditUnitScale)
}

func FormatCreditUnits(units int) string {
	if units%CreditUnitScale == 0 {
		return fmt.Sprintf("%d", units/CreditUnitScale)
	}
	return fmt.Sprintf("%.1f", UnitsToCredits(units))
}

// Balance keeps the legacy whole-credit API. New API responses should use BalanceCredits.
func (store *AICreditsStore) Balance(serial string) int {
	return store.BalanceUnits(serial) / CreditUnitScale
}

func (store *AICreditsStore) BalanceCredits(serial string) float64 {
	return UnitsToCredits(store.BalanceUnits(serial))
}

func (store *AICreditsStore) BalanceUnits(serial string) int {
	store.ensureUnitScale()
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return DefaultAICreditUnits
	}
	if store.Balances == nil {
		return DefaultAICreditUnits
	}
	balance, ok := store.Balances[serial]
	if !ok {
		return DefaultAICreditUnits
	}
	if balance < 0 {
		return 0
	}
	return balance
}

// TryReloadAICreditsStore reloads from disk when the file changed (e.g. admin GUI sync).
func TryReloadAICreditsStore(path string, current *AICreditsStore, lastMod *time.Time) error {
	if current == nil || lastMod == nil {
		return fmt.Errorf("invalid reload state")
	}
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !lastMod.IsZero() && !info.ModTime().After(*lastMod) {
		return nil
	}
	latest, err := LoadAICreditsStore(path)
	if err != nil {
		return err
	}
	*current = latest
	*lastMod = info.ModTime()
	return nil
}

func (store *AICreditsStore) Spend(serial string, amount int) (int, error) {
	if amount <= 0 {
		amount = AICreditCostPerGeneration
	}
	nextUnits, err := store.SpendUnits(serial, CreditsToUnits(amount))
	return nextUnits / CreditUnitScale, err
}

func (store *AICreditsStore) SpendUnits(serial string, amountUnits int) (int, error) {
	store.ensureUnitScale()
	if amountUnits <= 0 {
		amountUnits = AICreditCostPerGenerationUnits
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0, fmt.Errorf("设备 SN 无效")
	}
	balance := store.BalanceUnits(serial)
	if balance < amountUnits {
		return balance, fmt.Errorf("积分不足，剩余 %s，每次消耗 %s 积分", FormatCreditUnits(balance), FormatCreditUnits(amountUnits))
	}
	next := balance - amountUnits
	store.Balances[serial] = next
	return next, nil
}

// Earn adds credits for rewarded actions such as receiving a like on uploaded material.
func (store *AICreditsStore) Earn(serial string, amount int) (int, error) {
	if amount <= 0 {
		amount = LikeCreditRewardAmount
	}
	nextUnits, err := store.EarnUnits(serial, CreditsToUnits(amount))
	return nextUnits / CreditUnitScale, err
}

func (store *AICreditsStore) EarnUnits(serial string, amountUnits int) (int, error) {
	store.ensureUnitScale()
	if amountUnits <= 0 {
		return store.BalanceUnits(serial), fmt.Errorf("奖励积分无效")
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0, fmt.Errorf("设备 SN 无效")
	}
	next := store.BalanceUnits(serial) + amountUnits
	store.Balances[serial] = next
	return next, nil
}

// SpendShop deducts credits for shop redemption.
func (store *AICreditsStore) SpendShop(serial string, amount int, itemTitle string) (float64, error) {
	if amount <= 0 {
		return store.BalanceCredits(serial), fmt.Errorf("商品积分无效")
	}
	nextUnits, err := store.SpendUnits(serial, CreditsToUnits(amount))
	if err != nil {
		return UnitsToCredits(nextUnits), fmt.Errorf("积分不足，剩余 %s，兑换「%s」需要 %d 积分", FormatCreditUnits(nextUnits), itemTitle, amount)
	}
	return UnitsToCredits(nextUnits), nil
}

func (store *AICreditsStore) RefundUnits(serial string, amountUnits int) int {
	store.ensureUnitScale()
	if amountUnits <= 0 {
		return store.BalanceUnits(serial)
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return DefaultAICreditUnits
	}
	next := store.BalanceUnits(serial) + amountUnits
	store.Balances[serial] = next
	return next
}

func (store *AICreditsStore) Refund(serial string, amount int) int {
	if amount <= 0 {
		return store.Balance(serial)
	}
	return store.RefundUnits(serial, CreditsToUnits(amount)) / CreditUnitScale
}
