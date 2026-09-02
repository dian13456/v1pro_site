package main

import (
	"context"
	"log"
	"strings"
	"time"

	"jiadian-hub-backend/service"
)

func reconcileExpiredMallPayments(ctx context.Context, client *service.WeChatPayClient, mall *service.MallService) {
	if client == nil || !client.Available() || mall == nil {
		return
	}
	orders, err := mall.ListAdminOrders()
	if err != nil {
		log.Printf("warn: list expired mall payments failed: %v", err)
		return
	}
	now := time.Now().UnixMilli()
	for _, order := range orders {
		if order.Status != service.MallOrderPendingPay || order.PaymentMethod != "wechat" ||
			order.PaymentExpiresAt <= 0 || order.PaymentExpiresAt > now {
			continue
		}
		orderCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		transaction, queryErr := client.QueryTransaction(orderCtx, order.PaymentTradeNo)
		if queryErr != nil {
			if service.IsWeChatPayAPIError(queryErr, "ORDER_NOT_EXIST") {
				if _, cancelErr := mall.CancelMyPendingOrder(order.UserSerial, order.ID); cancelErr != nil {
					log.Printf("warn: release expired mall order %s failed: %v", order.ID, cancelErr)
				}
			} else {
				log.Printf("warn: query expired mall payment %s failed: %v", order.ID, queryErr)
			}
			cancel()
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(transaction.TradeState)) {
		case "SUCCESS":
			if _, err := mall.MarkWechatOrderPaid(transaction.OutTradeNo, transaction.TransactionID, transaction.Amount.Total); err != nil {
				log.Printf("error: reconcile paid mall order %s failed: %v", order.ID, err)
			}
		case "NOTPAY":
			if err := client.CloseTransaction(orderCtx, order.PaymentTradeNo); err != nil {
				log.Printf("warn: close expired mall payment %s failed: %v", order.ID, err)
				cancel()
				continue
			}
			if _, err := mall.CancelMyPendingOrder(order.UserSerial, order.ID); err != nil {
				log.Printf("warn: release expired mall order %s failed: %v", order.ID, err)
			}
		case "CLOSED", "REVOKED", "PAYERROR":
			if _, err := mall.CancelMyPendingOrder(order.UserSerial, order.ID); err != nil {
				log.Printf("warn: release closed mall order %s failed: %v", order.ID, err)
			}
		default:
			log.Printf("warn: expired mall order %s remains in WeChat state %s", order.ID, transaction.TradeState)
		}
		cancel()
	}
}

func startMallPaymentReconciler(client *service.WeChatPayClient, mall *service.MallService, interval time.Duration) func() {
	if client == nil || !client.Available() || mall == nil {
		return func() {}
	}
	if interval < 15*time.Second {
		interval = time.Minute
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-stop:
			return
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			reconcileExpiredMallPayments(ctx, client, mall)
			cancel()
			select {
			case <-ticker.C:
			case <-stop:
				return
			}
		}
	}()
	return func() {
		close(stop)
		<-done
	}
}
