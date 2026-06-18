package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	ShopEffectAddCredits   = "add_credits"
	ShopEffectResetAIShare = "reset_ai_share"
	ShopEffectGrantCode    = "grant_code"
)

type ShopEffect struct {
	Type   string `json:"type"`
	Amount int    `json:"amount,omitempty"`
	Code   string `json:"code,omitempty"`
}

type ShopItem struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Cost        int        `json:"cost"`
	Effect      ShopEffect `json:"effect"`
}

type ShopCatalog struct {
	Items []ShopItem `json:"items"`
}

func LoadShopCatalog(path string) (ShopCatalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ShopCatalog{}, nil
		}
		return ShopCatalog{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return ShopCatalog{}, nil
	}
	var catalog ShopCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return ShopCatalog{}, err
	}
	valid := make([]ShopItem, 0, len(catalog.Items))
	for _, item := range catalog.Items {
		item.ID = strings.TrimSpace(item.ID)
		item.Title = strings.TrimSpace(item.Title)
		if item.ID == "" || item.Title == "" || item.Cost <= 0 {
			continue
		}
		item.Effect.Type = strings.TrimSpace(item.Effect.Type)
		if item.Effect.Type == "" {
			continue
		}
		if item.Effect.Type == ShopEffectGrantCode && strings.TrimSpace(item.Effect.Code) == "" {
			continue
		}
		valid = append(valid, item)
	}
	catalog.Items = valid
	return catalog, nil
}

func (catalog ShopCatalog) FindItem(itemID string) (ShopItem, bool) {
	itemID = strings.TrimSpace(itemID)
	for _, item := range catalog.Items {
		if item.ID == itemID {
			return item, true
		}
	}
	return ShopItem{}, false
}

// PublicItems returns catalog items safe for client display (secrets stripped).
func (catalog ShopCatalog) PublicItems() []ShopItem {
	items := make([]ShopItem, len(catalog.Items))
	for i, item := range catalog.Items {
		items[i] = item
		if items[i].Effect.Type == ShopEffectGrantCode {
			items[i].Effect.Code = ""
		}
	}
	return items
}

type ShopRedeemInput struct {
	Serial string
	ItemID string
}

type ShopRedeemResult struct {
	ItemID           string `json:"itemId"`
	Title            string `json:"title"`
	Cost             int    `json:"cost"`
	CreditsRemaining int    `json:"creditsRemaining"`
	RewardCredits    int    `json:"rewardCredits,omitempty"`
	RedeemCode       string `json:"redeemCode,omitempty"`
	ShareCount       int    `json:"shareCount,omitempty"`
	ShareRemaining   int    `json:"shareRemaining,omitempty"`
	Message          string `json:"message"`
}

func RedeemShopItem(
	input ShopRedeemInput,
	catalog ShopCatalog,
	credits *AICreditsStore,
	shareQuota *AIShareQuotaStore,
) (ShopRedeemResult, error) {
	item, ok := catalog.FindItem(input.ItemID)
	if !ok {
		return ShopRedeemResult{}, fmt.Errorf("商品不存在或已下架")
	}

	remaining, err := credits.SpendShop(input.Serial, item.Cost, item.Title)
	if err != nil {
		return ShopRedeemResult{Cost: item.Cost, CreditsRemaining: remaining}, err
	}

	result := ShopRedeemResult{
		ItemID:           item.ID,
		Title:            item.Title,
		Cost:             item.Cost,
		CreditsRemaining: remaining,
	}

	switch item.Effect.Type {
	case ShopEffectAddCredits:
		amount := item.Effect.Amount
		if amount <= 0 {
			amount = item.Cost
		}
		next, earnErr := credits.Earn(input.Serial, amount)
		if earnErr != nil {
			return result, earnErr
		}
		result.RewardCredits = amount
		result.CreditsRemaining = next
		result.Message = fmt.Sprintf("兑换成功，已获得 %d 积分", amount)
	case ShopEffectResetAIShare:
		if shareQuota == nil {
			return result, fmt.Errorf("分享配额未初始化")
		}
		if shareQuota.Counts == nil {
			shareQuota.Counts = map[string]int{}
		}
		serial := strings.TrimSpace(input.Serial)
		shareQuota.Counts[serial] = 0
		result.ShareCount = 0
		result.ShareRemaining = RemainingAIShares(0, MaxAISharesPerDevice)
		result.Message = "兑换成功，AI 分享次数已重置"
	case ShopEffectGrantCode:
		code := strings.TrimSpace(item.Effect.Code)
		if code == "" {
			refund := credits.Refund(input.Serial, item.Cost)
			result.CreditsRemaining = refund
			return result, fmt.Errorf("兑换码未配置")
		}
		result.RedeemCode = code
		result.Message = fmt.Sprintf("兑换成功，请妥善保存兑换码：%s", code)
	default:
		refund := credits.Refund(input.Serial, item.Cost)
		result.CreditsRemaining = refund
		return result, fmt.Errorf("不支持的商品类型")
	}

	return result, nil
}

func DefaultShopItemsPath(configDir string) string {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	return filepath.Join(configDir, "shop_items.json")
}
