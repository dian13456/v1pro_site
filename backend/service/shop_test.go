package service

import "testing"

func TestPublicItemsStripsRedeemCode(t *testing.T) {
	catalog := ShopCatalog{
		Items: []ShopItem{
			{
				ID:    "v1pro_miaomiao_shell_77",
				Title: "V1PRO CNC 喵喵壳子 77帧",
				Cost:  1350,
				Effect: ShopEffect{
					Type: ShopEffectGrantCode,
					Code: "SECRET123",
				},
			},
		},
	}
	publicItems := catalog.PublicItems()
	if len(publicItems) != 1 {
		t.Fatalf("expected 1 item, got %d", len(publicItems))
	}
	if publicItems[0].Effect.Code != "" {
		t.Fatalf("expected code stripped from public item, got %q", publicItems[0].Effect.Code)
	}
}

func TestRedeemGrantCode(t *testing.T) {
	catalog := ShopCatalog{
		Items: []ShopItem{
			{
				ID:          "v1pro_miaomiao_shell_77",
				Title:       "V1PRO CNC 喵喵壳子 77帧",
				Cost:        1350,
				Effect:      ShopEffect{Type: ShopEffectGrantCode, Code: "MIAOMIAO77"},
				Description: "test",
			},
		},
	}
	credits := AICreditsStore{Balances: map[string]int{"SN001": 2000}}
	result, err := RedeemShopItem(
		ShopRedeemInput{Serial: "SN001", ItemID: "v1pro_miaomiao_shell_77"},
		catalog,
		&credits,
		nil,
	)
	if err != nil {
		t.Fatalf("redeem failed: %v", err)
	}
	if result.RedeemCode != "MIAOMIAO77" {
		t.Fatalf("expected redeem code, got %q", result.RedeemCode)
	}
	if result.CreditsRemaining != 650 {
		t.Fatalf("expected 650 credits remaining, got %d", result.CreditsRemaining)
	}
}
