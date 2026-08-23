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
	credits := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances:  map[string]int{"SN001": CreditsToUnits(2000)},
	}
	result, err := RedeemShopItem(
		ShopRedeemInput{Serial: "SN001", ItemID: "v1pro_miaomiao_shell_77"},
		catalog,
		&credits,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("redeem failed: %v", err)
	}
	if result.RedeemCode != "MIAOMIAO77" {
		t.Fatalf("expected redeem code, got %q", result.RedeemCode)
	}
	if result.CreditsRemaining != 650 {
		t.Fatalf("expected 650 credits remaining, got %v", result.CreditsRemaining)
	}
}

func TestRedeemPhysicalCreatesPaidOrderAndDecrementsStock(t *testing.T) {
	repo, err := NewMallRepo(t.TempDir())
	if err != nil {
		t.Fatalf("new mall repo: %v", err)
	}
	mall := NewMallService(repo, "test-secret")
	product, err := mall.UpsertProduct(MallProduct{
		ID: "physical-shell", Title: "实体外壳", PriceCents: 9900,
		Stock: 2, Status: MallProductOnSale,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	catalog := ShopCatalog{Items: []ShopItem{{
		ID: "points-shell", Title: "积分实体外壳", Cost: 100,
		Effect: ShopEffect{Type: ShopEffectPhysical, ProductID: product.ID},
	}}}
	credits := AICreditsStore{
		UnitScale: CreditUnitScale,
		Balances:  map[string]int{"SN001": CreditsToUnits(200)},
	}
	result, err := RedeemShopItem(
		ShopRedeemInput{
			Serial: "SN001", ItemID: "points-shell",
			Shipping: MallShippingPlain{
				Name: "测试用户", Phone: "13800138000", QQ: "12345",
				Province: "广东省", City: "深圳市", Address: "测试路 1 号",
			},
		},
		catalog,
		&credits,
		nil,
		mall,
	)
	if err != nil {
		t.Fatalf("redeem physical: %v", err)
	}
	if result.OrderID == "" || result.OrderStatus != MallOrderPaid {
		t.Fatalf("unexpected order result: %+v", result)
	}
	if result.CreditsRemaining != 100 {
		t.Fatalf("expected 100 credits remaining, got %v", result.CreditsRemaining)
	}
	stock, err := mall.PointRedemptionStock(product.ID)
	if err != nil || stock != 1 {
		t.Fatalf("expected stock 1, got %d, err=%v", stock, err)
	}
	orders, err := mall.ListMyOrders("SN001")
	if err != nil || len(orders) != 1 || !orders[0].HasAddress {
		t.Fatalf("unexpected orders: %+v, err=%v", orders, err)
	}
	if _, err := mall.UpdateOrderStatus(result.OrderID, MallOrderCancelled, ""); err == nil {
		t.Fatal("expected direct cancellation of points redemption to be rejected")
	}
	if err := mall.RollbackPointRedemptionOrder(result.OrderID); err != nil {
		t.Fatalf("rollback points redemption: %v", err)
	}
	stock, err = mall.PointRedemptionStock(product.ID)
	if err != nil || stock != 2 {
		t.Fatalf("expected restored stock 2, got %d, err=%v", stock, err)
	}
}

func TestListPublicProductsHidesPointsOnlyInventory(t *testing.T) {
	repo, err := NewMallRepo(t.TempDir())
	if err != nil {
		t.Fatalf("new mall repo: %v", err)
	}
	service := NewMallService(repo, "test-secret")
	if _, err := service.UpsertProduct(MallProduct{
		ID: "points-only-board", Title: "佳点V1PRO 77帧板子", PriceCents: 0,
		Stock: 20, Status: MallProductOnSale,
	}); err != nil {
		t.Fatalf("upsert points-only product: %v", err)
	}
	items, err := service.ListPublicProducts()
	if err != nil {
		t.Fatalf("list public products: %v", err)
	}
	for _, item := range items {
		if item.ID == "points-only-board" {
			t.Fatal("points-only inventory must not appear in the cash mall")
		}
	}
	stock, err := service.PointRedemptionStock("points-only-board")
	if err != nil || stock != 20 {
		t.Fatalf("points-only inventory should remain redeemable, stock=%d err=%v", stock, err)
	}
}
