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
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &mallMySQLStore{db: db}, nil
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
(id, user_serial, status, items_json, total_cents, name_enc, phone_enc, wechat_enc, qq_enc,
 province, city, address_enc, tracking_no, remark, created_at, updated_at, paid_at, shipped_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order.ID, order.UserSerial, order.Status, string(itemsJSON), order.TotalCents,
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
SELECT id, user_serial, status, items_json, total_cents, name_enc, phone_enc, wechat_enc, qq_enc,
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
SELECT id, user_serial, status, items_json, total_cents, name_enc, phone_enc, wechat_enc, qq_enc,
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
SELECT id, user_serial, status, items_json, total_cents, name_enc, phone_enc, wechat_enc, qq_enc,
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

func (s *mallMySQLStore) UpdateOrder(ctx context.Context, order MallOrder, restoreStock map[string]int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	itemsJSON, err := json.Marshal(order.Items)
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `
UPDATE mall_order SET status=?, items_json=?, total_cents=?, tracking_no=?, remark=?,
 updated_at=?, paid_at=?, shipped_at=? WHERE id=?`,
		order.Status, string(itemsJSON), order.TotalCents, order.TrackingNo, order.Remark,
		order.UpdatedAt, order.PaidAt, order.ShippedAt, order.ID,
	)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return errors.New("订单不存在")
	}
	for pid, delta := range restoreStock {
		if _, err := tx.ExecContext(ctx,
			`UPDATE mall_product SET stock=stock+?, updated_at=? WHERE id=?`,
			delta, time.Now().UnixMilli(), pid,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
