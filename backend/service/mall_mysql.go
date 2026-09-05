package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type mallMySQLStore struct {
	db *sql.DB
}

func openMallMySQLStore(dsn string) (*mallMySQLStore, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, errors.New("MYSQL_DSN 未配置")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(dbPoolSize("MYSQL_MAX_OPEN_CONNS", 10))
	db.SetMaxIdleConns(dbPoolSize("MYSQL_MAX_IDLE_CONNS", 5))
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	store := &mallMySQLStore{db: db}
	if err := store.ensurePaymentColumns(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *mallMySQLStore) ensurePaymentColumns(ctx context.Context) error {
	columns := []struct {
		name       string
		definition string
	}{
		{"payment_method", "VARCHAR(32) NOT NULL DEFAULT '' AFTER total_cents"},
		{"payment_mode", "VARCHAR(16) NOT NULL DEFAULT '' AFTER payment_method"},
		{"payment_trade_no", "VARCHAR(64) NOT NULL DEFAULT '' AFTER payment_mode"},
		{"payment_transaction_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER payment_trade_no"},
		{"payment_expires_at", "BIGINT NOT NULL DEFAULT 0 AFTER payment_transaction_id"},
		{"stock_reserved", "TINYINT(1) NOT NULL DEFAULT 0 AFTER payment_expires_at"},
	}
	for _, column := range columns {
		var count int
		if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mall_order' AND COLUMN_NAME=?`, column.name).Scan(&count); err != nil {
			return fmt.Errorf("check mall_order.%s failed: %w", column.name, err)
		}
		if count > 0 {
			continue
		}
		statement := "ALTER TABLE mall_order ADD COLUMN " + column.name + " " + column.definition
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("add mall_order.%s failed: %w", column.name, err)
		}
	}
	var indexCount int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mall_order' AND INDEX_NAME='idx_mall_order_payment_trade'`).Scan(&indexCount); err != nil {
		return fmt.Errorf("check mall_order payment index failed: %w", err)
	}
	if indexCount == 0 {
		if _, err := s.db.ExecContext(ctx, `CREATE INDEX idx_mall_order_payment_trade ON mall_order(payment_trade_no)`); err != nil {
			return fmt.Errorf("add mall_order payment index failed: %w", err)
		}
	}
	return nil
}

func (s *mallMySQLStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *mallMySQLStore) scanProduct(scanner interface {
	Scan(dest ...any) error
}, withImageURLs bool) (MallProduct, error) {
	var p MallProduct
	var imageURLsRaw sql.NullString
	if withImageURLs {
		err := scanner.Scan(
			&p.ID, &p.Title, &p.Description, &p.ImageURL, &imageURLsRaw, &p.PriceCents, &p.Stock,
			&p.Status, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return MallProduct{}, err
		}
		p.ImageURLs = DecodeMallImageURLs(imageURLsRaw.String, p.ImageURL)
	} else {
		err := scanner.Scan(
			&p.ID, &p.Title, &p.Description, &p.ImageURL, &p.PriceCents, &p.Stock,
			&p.Status, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return MallProduct{}, err
		}
		p.ImageURLs = DecodeMallImageURLs("", p.ImageURL)
	}
	NormalizeMallProductImages(&p)
	return p, nil
}

func (s *mallMySQLStore) listProductsQuery(includeOffSale bool, withImageURLs bool) string {
	imageCol := ""
	if withImageURLs {
		imageCol = ", image_urls"
	}
	query := `SELECT id, title, description, image_url` + imageCol + `, price_cents, stock, status, sort_order, created_at, updated_at
FROM mall_product`
	if !includeOffSale {
		query += ` WHERE status='on_sale'`
	}
	return query + ` ORDER BY sort_order ASC, updated_at DESC`
}

func (s *mallMySQLStore) ListProducts(ctx context.Context, includeOffSale bool) ([]MallProduct, error) {
	withImageURLs := true
	rows, err := s.db.QueryContext(ctx, s.listProductsQuery(includeOffSale, withImageURLs))
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "image_urls") {
		withImageURLs = false
		rows, err = s.db.QueryContext(ctx, s.listProductsQuery(includeOffSale, withImageURLs))
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MallProduct, 0)
	for rows.Next() {
		p, err := s.scanProduct(rows, withImageURLs)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *mallMySQLStore) GetProduct(ctx context.Context, id string) (MallProduct, bool, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, title, description, image_url, image_urls, price_cents, stock, status, sort_order, created_at, updated_at
FROM mall_product WHERE id=?`, id,
	)
	p, err := s.scanProduct(row, true)
	if err == nil {
		return p, true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return MallProduct{}, false, nil
	}
	if !strings.Contains(strings.ToLower(err.Error()), "image_urls") {
		return MallProduct{}, false, err
	}
	row = s.db.QueryRowContext(ctx,
		`SELECT id, title, description, image_url, price_cents, stock, status, sort_order, created_at, updated_at
FROM mall_product WHERE id=?`, id,
	)
	p, err = s.scanProduct(row, false)
	if errors.Is(err, sql.ErrNoRows) {
		return MallProduct{}, false, nil
	}
	if err != nil {
		return MallProduct{}, false, err
	}
	return p, true, nil
}

func (s *mallMySQLStore) UpsertProduct(ctx context.Context, p MallProduct) error {
	NormalizeMallProductImages(&p)
	imageURLsJSON := EncodeMallImageURLs(p.ImageURLs)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO mall_product
(id, title, description, image_url, image_urls, price_cents, stock, status, sort_order, created_at, updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
title=VALUES(title), description=VALUES(description), image_url=VALUES(image_url), image_urls=VALUES(image_urls),
price_cents=VALUES(price_cents), stock=VALUES(stock), status=VALUES(status),
sort_order=VALUES(sort_order), updated_at=VALUES(updated_at)`,
		p.ID, p.Title, p.Description, p.ImageURL, imageURLsJSON, p.PriceCents, p.Stock, p.Status, p.SortOrder, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "image_urls") {
		_, err = s.db.ExecContext(ctx, `
INSERT INTO mall_product
(id, title, description, image_url, price_cents, stock, status, sort_order, created_at, updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
title=VALUES(title), description=VALUES(description), image_url=VALUES(image_url),
price_cents=VALUES(price_cents), stock=VALUES(stock), status=VALUES(status),
sort_order=VALUES(sort_order), updated_at=VALUES(updated_at)`,
			p.ID, p.Title, p.Description, p.ImageURL, p.PriceCents, p.Stock, p.Status, p.SortOrder, p.CreatedAt, p.UpdatedAt,
		)
	}
	return err
}

func (s *mallMySQLStore) HasPendingOrdersForProduct(ctx context.Context, productID string) (bool, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT items_json FROM mall_order WHERE status=? LIMIT 500`, MallOrderPendingPay)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var itemsJSON string
		if err := rows.Scan(&itemsJSON); err != nil {
			return false, err
		}
		var items []MallOrderItem
		if err := json.Unmarshal([]byte(itemsJSON), &items); err != nil {
			continue
		}
		for _, item := range items {
			if item.ProductID == productID {
				return true, nil
			}
		}
	}
	return false, rows.Err()
}

func (s *mallMySQLStore) DeleteProduct(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM mall_product WHERE id=?`, id)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return errors.New("商品不存在")
	}
	return nil
}

func (s *mallMySQLStore) CreateOrder(ctx context.Context, order MallOrder, stockDelta map[string]int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for pid, delta := range stockDelta {
		res, err := tx.ExecContext(ctx,
			`UPDATE mall_product SET stock=stock+?, updated_at=? WHERE id=? AND stock+?>=0`,
			delta, time.Now().UnixMilli(), pid, delta,
		)
		if err != nil {
			return err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return fmt.Errorf("商品库存不足或不存在：%s", pid)
		}
	}

	itemsJSON, err := json.Marshal(order.Items)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO mall_order
(id, user_serial, status, items_json, total_cents, payment_method, payment_mode, payment_trade_no,
 payment_transaction_id, payment_expires_at, stock_reserved, name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order.ID, order.UserSerial, order.Status, string(itemsJSON), order.TotalCents,
		order.PaymentMethod, order.PaymentMode, order.PaymentTradeNo, order.PaymentTransactionID,
		order.PaymentExpiresAt, order.StockReserved,
		order.NameEnc, order.PhoneEnc, order.WechatEnc, order.QQEnc,
		order.Province, order.City, order.AddressEnc, order.TrackingNo, order.Remark,
		order.CreatedAt, order.UpdatedAt, order.PaidAt, order.ShippedAt,
	)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func scanMallOrder(scanner interface {
	Scan(dest ...any) error
}) (MallOrder, error) {
	var o MallOrder
	var itemsJSON string
	err := scanner.Scan(
		&o.ID, &o.UserSerial, &o.Status, &itemsJSON, &o.TotalCents,
		&o.PaymentMethod, &o.PaymentMode, &o.PaymentTradeNo, &o.PaymentTransactionID,
		&o.PaymentExpiresAt, &o.StockReserved,
		&o.NameEnc, &o.PhoneEnc, &o.WechatEnc, &o.QQEnc,
		&o.Province, &o.City, &o.AddressEnc, &o.TrackingNo, &o.Remark,
		&o.CreatedAt, &o.UpdatedAt, &o.PaidAt, &o.ShippedAt,
	)
	if err != nil {
		return MallOrder{}, err
	}
	_ = json.Unmarshal([]byte(itemsJSON), &o.Items)
	if o.Items == nil {
		o.Items = []MallOrderItem{}
	}
	return o, nil
}

func (s *mallMySQLStore) ListOrdersByUser(ctx context.Context, serial string) ([]MallOrder, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, user_serial, status, items_json, total_cents,
 payment_method, payment_mode, payment_trade_no, payment_transaction_id, payment_expires_at, stock_reserved,
 name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at
FROM mall_order WHERE user_serial=? ORDER BY created_at DESC LIMIT 200`, serial)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MallOrder, 0)
	for rows.Next() {
		o, err := scanMallOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *mallMySQLStore) ListAllOrders(ctx context.Context) ([]MallOrder, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, user_serial, status, items_json, total_cents,
 payment_method, payment_mode, payment_trade_no, payment_transaction_id, payment_expires_at, stock_reserved,
 name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at
FROM mall_order ORDER BY created_at DESC LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MallOrder, 0)
	for rows.Next() {
		o, err := scanMallOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *mallMySQLStore) GetOrder(ctx context.Context, id string) (MallOrder, bool, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, user_serial, status, items_json, total_cents,
 payment_method, payment_mode, payment_trade_no, payment_transaction_id, payment_expires_at, stock_reserved,
 name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at
FROM mall_order WHERE id=?`, id)
	o, err := scanMallOrder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return MallOrder{}, false, nil
	}
	if err != nil {
		return MallOrder{}, false, err
	}
	return o, true, nil
}

func getMallOrderForUpdate(ctx context.Context, tx *sql.Tx, id string) (MallOrder, error) {
	row := tx.QueryRowContext(ctx, `
SELECT id, user_serial, status, items_json, total_cents,
 payment_method, payment_mode, payment_trade_no, payment_transaction_id, payment_expires_at, stock_reserved,
 name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at
FROM mall_order WHERE id=? FOR UPDATE`, id)
	return scanMallOrder(row)
}

func (s *mallMySQLStore) MarkWechatOrderPaid(ctx context.Context, orderID, transactionID string, amountCents int64) (MallOrder, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MallOrder{}, err
	}
	defer func() { _ = tx.Rollback() }()

	order, err := getMallOrderForUpdate(ctx, tx, orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return MallOrder{}, errors.New("订单不存在")
	}
	if err != nil {
		return MallOrder{}, err
	}
	if order.PaymentMethod != mallPaymentWechat || order.PaymentTradeNo != orderID {
		return MallOrder{}, errors.New("订单支付信息不匹配")
	}
	if order.TotalCents != amountCents || amountCents <= 0 {
		return MallOrder{}, errors.New("微信支付金额与订单不一致")
	}
	if order.Status == MallOrderCancelled {
		return MallOrder{}, errors.New("已取消订单收到付款通知，请人工核查并退款")
	}
	if order.PaymentTransactionID != "" && order.PaymentTransactionID != transactionID {
		return MallOrder{}, errors.New("订单微信支付交易号冲突")
	}
	if order.Status == MallOrderPaid || order.Status == MallOrderShipped {
		if order.PaymentTransactionID == "" {
			order.PaymentTransactionID = transactionID
			order.UpdatedAt = time.Now().UnixMilli()
			if _, err := tx.ExecContext(ctx, `UPDATE mall_order SET payment_transaction_id=?, updated_at=? WHERE id=?`, transactionID, order.UpdatedAt, order.ID); err != nil {
				return MallOrder{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return MallOrder{}, err
		}
		return order, nil
	}
	if order.Status != MallOrderPendingPay {
		return MallOrder{}, errors.New("当前订单状态无法确认微信付款")
	}
	if !order.StockReserved {
		for _, item := range order.Items {
			res, err := tx.ExecContext(ctx,
				`UPDATE mall_product SET stock=stock-?, updated_at=? WHERE id=? AND stock>=?`,
				item.Quantity, time.Now().UnixMilli(), item.ProductID, item.Quantity,
			)
			if err != nil {
				return MallOrder{}, err
			}
			affected, _ := res.RowsAffected()
			if affected == 0 {
				return MallOrder{}, fmt.Errorf("微信付款成功但商品库存不足：%s", item.ProductID)
			}
		}
	}
	now := time.Now().UnixMilli()
	order.Status = MallOrderPaid
	order.PaymentTransactionID = transactionID
	order.StockReserved = true
	order.PaidAt = now
	order.UpdatedAt = now
	if _, err := tx.ExecContext(ctx, `
UPDATE mall_order SET status=?, payment_transaction_id=?, stock_reserved=1, paid_at=?, updated_at=? WHERE id=?`,
		order.Status, order.PaymentTransactionID, order.PaidAt, order.UpdatedAt, order.ID,
	); err != nil {
		return MallOrder{}, err
	}
	if err := tx.Commit(); err != nil {
		return MallOrder{}, err
	}
	return order, nil
}

func (s *mallMySQLStore) CancelPendingWechatOrder(ctx context.Context, serial, orderID string) (MallOrder, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MallOrder{}, err
	}
	defer func() { _ = tx.Rollback() }()
	order, err := getMallOrderForUpdate(ctx, tx, orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return MallOrder{}, errors.New("订单不存在")
	}
	if err != nil {
		return MallOrder{}, err
	}
	if order.UserSerial != serial {
		return MallOrder{}, errors.New("订单不存在")
	}
	if order.PaymentMethod != mallPaymentWechat || order.Status != MallOrderPendingPay {
		return MallOrder{}, errors.New("当前订单不可取消")
	}
	if order.StockReserved {
		for _, item := range order.Items {
			if _, err := tx.ExecContext(ctx,
				`UPDATE mall_product SET stock=stock+?, updated_at=? WHERE id=?`,
				item.Quantity, time.Now().UnixMilli(), item.ProductID,
			); err != nil {
				return MallOrder{}, err
			}
		}
	}
	order.Status = MallOrderCancelled
	order.StockReserved = false
	order.UpdatedAt = time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx, `UPDATE mall_order SET status=?, stock_reserved=0, updated_at=? WHERE id=?`, order.Status, order.UpdatedAt, order.ID); err != nil {
		return MallOrder{}, err
	}
	if err := tx.Commit(); err != nil {
		return MallOrder{}, err
	}
	return order, nil
}

func (s *mallMySQLStore) UpdateOrder(ctx context.Context, order MallOrder, stockDelta map[string]int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for pid, delta := range stockDelta {
		if delta == 0 {
			continue
		}
		res, err := tx.ExecContext(ctx,
			`UPDATE mall_product SET stock=stock+?, updated_at=? WHERE id=? AND stock+?>=0`,
			delta, time.Now().UnixMilli(), pid, delta,
		)
		if err != nil {
			return err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return fmt.Errorf("商品库存不足或不存在：%s", pid)
		}
	}

	itemsJSON, err := json.Marshal(order.Items)
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE mall_order SET status=?, items_json=?, total_cents=?, tracking_no=?, remark=?,
	payment_method=?, payment_mode=?, payment_trade_no=?, payment_transaction_id=?, payment_expires_at=?, stock_reserved=?,
 updated_at=?, paid_at=?, shipped_at=? WHERE id=?`,
		order.Status, string(itemsJSON), order.TotalCents, order.TrackingNo, order.Remark,
		order.PaymentMethod, order.PaymentMode, order.PaymentTradeNo, order.PaymentTransactionID,
		order.PaymentExpiresAt, order.StockReserved,
		order.UpdatedAt, order.PaidAt, order.ShippedAt, order.ID,
	)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return errors.New("订单不存在")
	}
	return tx.Commit()
}
