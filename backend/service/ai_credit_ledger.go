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
	CreditSourceLikeReward         = "like_reward"
	CreditSourceLikeActorReward    = "like_actor_reward"
	CreditSourceDownloadReward     = "download_reward"
	CreditSourceAIGenerate         = "ai_generate"
	CreditSourceAIRefund           = "ai_refund"
	CreditSourceShopRedeem         = "shop_redeem"
	CreditSourceShopBonus          = "shop_bonus"

	maxCreditLedgerPerSerial = 200
)

// CreditLedgerEntry stores Amount in half-units (1 unit = 0.5 credit).
type CreditLedgerEntry struct {
	ID        string `json:"id"`
	Serial    string `json:"serial"`
	Amount    int    `json:"amount"`
	Source    string `json:"source"`
	Label     string `json:"label"`
	RefID     string `json:"refId,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// CreditLedgerView is the API-facing ledger row with Amount in credits.
type CreditLedgerView struct {
	ID        string  `json:"id"`
	Amount    float64 `json:"amount"`
	Source    string  `json:"source"`
	Label     string  `json:"label"`
	RefID     string  `json:"refId,omitempty"`
	CreatedAt string  `json:"createdAt"`
}

type CreditLedgerStore struct {
	UnitScale int                 `json:"unitScale"`
	Entries   []CreditLedgerEntry `json:"entries"`
}

func LoadCreditLedgerStore(path string) (CreditLedgerStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return newCreditLedgerStore(), nil
		}
		return CreditLedgerStore{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return newCreditLedgerStore(), nil
	}
	var store CreditLedgerStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return CreditLedgerStore{}, err
	}
	if store.Entries == nil {
		store.Entries = []CreditLedgerEntry{}
	}
	store.ensureUnitScale()
	return store, nil
}

func SaveCreditLedgerStore(path string, store CreditLedgerStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if store.Entries == nil {
		store.Entries = []CreditLedgerEntry{}
	}
	store.ensureUnitScale()
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}

func newCreditLedgerStore() CreditLedgerStore {
	return CreditLedgerStore{UnitScale: CreditUnitScale, Entries: []CreditLedgerEntry{}}
}

func (store *CreditLedgerStore) ensureUnitScale() {
	if store.UnitScale == CreditUnitScale {
		return
	}
	for i := range store.Entries {
		store.Entries[i].Amount *= CreditUnitScale
	}
	store.UnitScale = CreditUnitScale
}

func NewCreditLedgerEntry(serial string, amountUnits int, source, label, refID string) CreditLedgerEntry {
	serial = strings.TrimSpace(serial)
	source = strings.TrimSpace(source)
	label = strings.TrimSpace(label)
	if label == "" {
		label = CreditLedgerSourceLabel(source)
	}
	return CreditLedgerEntry{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Serial:    serial,
		Amount:    amountUnits,
		Source:    source,
		Label:     label,
		RefID:     strings.TrimSpace(refID),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func CreditLedgerSourceLabel(source string) string {
	switch strings.TrimSpace(source) {
	case CreditSourceLikeReward:
		return "素材被点赞"
	case CreditSourceLikeActorReward:
		return "点赞他人素材"
	case CreditSourceDownloadReward:
		return "素材被下载"
	case CreditSourceAIGenerate:
		return "AI 生图消耗"
	case CreditSourceAIRefund:
		return "AI 生图失败退还"
	case CreditSourceShopRedeem:
		return "积分商城兑换"
	case CreditSourceShopBonus:
		return "商城兑换奖励"
	default:
		return "积分变动"
	}
}

func ToCreditLedgerViews(entries []CreditLedgerEntry) []CreditLedgerView {
	out := make([]CreditLedgerView, 0, len(entries))
	for _, entry := range entries {
		view := CreditLedgerView{
			ID:        entry.ID,
			Amount:    UnitsToCredits(entry.Amount),
			Source:    entry.Source,
			Label:     entry.Label,
			CreatedAt: entry.CreatedAt,
		}
		if ref := strings.TrimSpace(entry.RefID); ref != "" {
			view.RefID = ref
		}
		out = append(out, view)
	}
	return out
}

func appendCreditLedgerEntryJSON(path string, entry CreditLedgerEntry) error {
	store, err := LoadCreditLedgerStore(path)
	if err != nil {
		return err
	}
	store.Entries = append(store.Entries, entry)
	store.Entries = trimCreditLedgerStore(store.Entries)
	return SaveCreditLedgerStore(path, store)
}

func listCreditLedgerEntriesJSON(path, serial string, limit int) ([]CreditLedgerEntry, error) {
	store, err := LoadCreditLedgerStore(path)
	if err != nil {
		return nil, err
	}
	return filterCreditLedgerEntries(store.Entries, serial, limit), nil
}

func trimCreditLedgerStore(entries []CreditLedgerEntry) []CreditLedgerEntry {
	if len(entries) == 0 {
		return entries
	}
	perSerial := map[string]int{}
	trimmed := make([]CreditLedgerEntry, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		entry := entries[i]
		serial := strings.TrimSpace(entry.Serial)
		if serial == "" {
			continue
		}
		if perSerial[serial] >= maxCreditLedgerPerSerial {
			continue
		}
		perSerial[serial]++
		trimmed = append(trimmed, entry)
	}
	for i, j := 0, len(trimmed)-1; i < j; i, j = i+1, j-1 {
		trimmed[i], trimmed[j] = trimmed[j], trimmed[i]
	}
	return trimmed
}

func filterCreditLedgerEntries(entries []CreditLedgerEntry, serial string, limit int) []CreditLedgerEntry {
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return []CreditLedgerEntry{}
	}
	if limit <= 0 {
		limit = 50
	}
	out := make([]CreditLedgerEntry, 0, limit)
	for i := len(entries) - 1; i >= 0; i-- {
		if strings.TrimSpace(entries[i].Serial) != serial {
			continue
		}
		item := entries[i]
		item.Serial = ""
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func DefaultCreditLedgerPath(configDir string) string {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	return filepath.Join(configDir, "ai_credit_ledger.json")
}
