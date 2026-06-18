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
)

type AICreditsStore struct {
	Balances map[string]int `json:"balances"`
}

func LoadAICreditsStore(path string) (AICreditsStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return AICreditsStore{Balances: map[string]int{}}, nil
		}
		return AICreditsStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return AICreditsStore{Balances: map[string]int{}}, nil
	}
	var store AICreditsStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return AICreditsStore{}, err
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	return store, nil
}

func SaveAICreditsStore(path string, store AICreditsStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func (store AICreditsStore) Balance(serial string) int {
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return DefaultAICredits
	}
	if store.Balances == nil {
		return DefaultAICredits
	}
	balance, ok := store.Balances[serial]
	if !ok {
		return DefaultAICredits
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
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0, fmt.Errorf("设备 SN 无效")
	}
	balance := store.Balance(serial)
	if balance < amount {
		return balance, fmt.Errorf("积分不足，剩余 %d，每次生图消耗 %d 积分", balance, amount)
	}
	next := balance - amount
	store.Balances[serial] = next
	return next, nil
}

// Earn adds credits for rewarded actions such as receiving a like on uploaded material.
func (store *AICreditsStore) Earn(serial string, amount int) (int, error) {
	if amount <= 0 {
		amount = LikeCreditRewardAmount
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0, fmt.Errorf("设备 SN 无效")
	}
	next := store.Balance(serial) + amount
	store.Balances[serial] = next
	return next, nil
}

// SpendShop deducts credits for shop redemption.
func (store *AICreditsStore) SpendShop(serial string, amount int, itemTitle string) (int, error) {
	if amount <= 0 {
		return store.Balance(serial), fmt.Errorf("商品积分无效")
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return 0, fmt.Errorf("设备 SN 无效")
	}
	balance := store.Balance(serial)
	if balance < amount {
		return balance, fmt.Errorf("积分不足，剩余 %d，兑换「%s」需要 %d 积分", balance, itemTitle, amount)
	}
	next := balance - amount
	store.Balances[serial] = next
	return next, nil
}

func (store *AICreditsStore) Refund(serial string, amount int) int {
	if amount <= 0 {
		return store.Balance(serial)
	}
	if store.Balances == nil {
		store.Balances = map[string]int{}
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return DefaultAICredits
	}
	next := store.Balance(serial) + amount
	store.Balances[serial] = next
	return next
}
