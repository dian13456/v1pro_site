package service

import (
	"testing"
	"time"
)

func mallWechatTestShipping() MallShippingPlain {
	return MallShippingPlain{
		Name:     "测试用户",
		Phone:    "13800138000",
		Wechat:   "wechat-test",
		QQ:       "12345678",
		Province: "广东省",
		City:     "广州市",
		Address:  "测试路 1 号",
	}
}

func TestWechatOrderReservesStockAndPaymentIsIdempotent(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewMallRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewMallService(repo, "test-secret")
	product, err := service.UpsertProduct(MallProduct{
		ID:         "wechat-test-product",
		Title:      "微信支付测试商品",
		PriceCents: 1990,
		Stock:      2,
		Status:     MallProductOnSale,
	})
	if err != nil {
		t.Fatal(err)
	}

	order, err := service.CreateOrder(MallCreateOrderInput{
		UserSerial:       "SN-PAY-TEST",
		Items:            []MallOrderItem{{ProductID: product.ID, Quantity: 1}},
		Shipping:         mallWechatTestShipping(),
		PaymentMethod:    mallPaymentWechat,
		PaymentExpiresAt: time.Now().Add(15 * time.Minute).UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	storedProduct, _, err := repo.GetProduct(product.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedProduct.Stock != 1 {
		t.Fatalf("stock was not reserved: got %d", storedProduct.Stock)
	}
	if _, err := service.UpdateOrderStatus(order.ID, MallOrderPaid, ""); err == nil {
		t.Fatal("manual status update bypassed WeChat payment confirmation")
	}

	paid, err := service.MarkWechatOrderPaid(order.ID, "wx-transaction-1", order.TotalCents)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != MallOrderPaid || paid.PaymentTransactionID != "wx-transaction-1" {
		t.Fatalf("unexpected paid order: %#v", paid)
	}
	if _, err := service.MarkWechatOrderPaid(order.ID, "wx-transaction-1", order.TotalCents); err != nil {
		t.Fatalf("idempotent callback failed: %v", err)
	}
	storedProduct, _, _ = repo.GetProduct(product.ID)
	if storedProduct.Stock != 1 {
		t.Fatalf("idempotent callback deducted stock twice: got %d", storedProduct.Stock)
	}
	if _, err := service.MarkWechatOrderPaid(order.ID, "wx-transaction-conflict", order.TotalCents); err == nil {
		t.Fatal("conflicting transaction id was accepted")
	}
}

func TestWechatOrderCancellationRestoresReservedStock(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewMallRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewMallService(repo, "test-secret")
	product, err := service.UpsertProduct(MallProduct{
		ID:         "wechat-cancel-product",
		Title:      "取消测试商品",
		PriceCents: 990,
		Stock:      1,
		Status:     MallProductOnSale,
	})
	if err != nil {
		t.Fatal(err)
	}
	order, err := service.CreateOrder(MallCreateOrderInput{
		UserSerial:       "SN-CANCEL-TEST",
		Items:            []MallOrderItem{{ProductID: product.ID, Quantity: 1}},
		Shipping:         mallWechatTestShipping(),
		PaymentMethod:    mallPaymentWechat,
		PaymentExpiresAt: time.Now().Add(15 * time.Minute).UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	reserved, _, _ := repo.GetProduct(product.ID)
	if reserved.Stock != 0 {
		t.Fatalf("stock was not reserved: got %d", reserved.Stock)
	}

	cancelled, err := service.CancelMyPendingOrder("SN-CANCEL-TEST", order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != MallOrderCancelled {
		t.Fatalf("unexpected status: %s", cancelled.Status)
	}
	restored, _, _ := repo.GetProduct(product.ID)
	if restored.Stock != 1 {
		t.Fatalf("stock was not restored: got %d", restored.Stock)
	}
	if _, err := service.CancelMyPendingOrder("SN-CANCEL-TEST", order.ID); err == nil {
		t.Fatal("cancelled order was cancelled twice")
	}
}
