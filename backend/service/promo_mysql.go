package service

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type promoMySQLStore struct {
	db *sql.DB
}

func openPromoMySQLStore(dsn string) (*promoMySQLStore, error) {
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
	if err := ensurePromoMySQLSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &promoMySQLStore{db: db}, nil
}

func ensurePromoMySQLSchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS promo_submission (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  choice_group VARCHAR(64) NOT NULL,
  user_serial VARCHAR(191) NOT NULL,
  order_no VARCHAR(191) NOT NULL DEFAULT '',
  order_screenshot_url TEXT NOT NULL,
  injection_color_note TEXT NOT NULL,
  shipping_address_enc TEXT NOT NULL,
  video_link TEXT NOT NULL,
  payment_qr_url_enc TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  admin_note TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_promo_user_group (user_serial, choice_group),
  KEY idx_promo_campaign_status (campaign_id, status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func (s *promoMySQLStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func scanPromoSubmission(scanner interface {
	Scan(dest ...any) error
}) (PromoSubmission, error) {
	var item PromoSubmission
	err := scanner.Scan(
		&item.ID, &item.CampaignID, &item.ChoiceGroup, &item.UserSerial,
		&item.OrderNo, &item.OrderScreenshotURL, &item.InjectionColorNote,
		&item.ShippingAddressEnc, &item.VideoLink, &item.PaymentQrURLEnc,
		&item.Status, &item.AdminNote, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (s *promoMySQLStore) findByUserAndGroup(ctx context.Context, userSerial, choiceGroup string) (*PromoSubmission, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, campaign_id, choice_group, user_serial, order_no, order_screenshot_url,
       injection_color_note, shipping_address_enc, video_link, payment_qr_url_enc,
       status, admin_note, created_at, updated_at
FROM promo_submission
WHERE user_serial = ? AND choice_group = ?
ORDER BY created_at DESC
LIMIT 1`, userSerial, choiceGroup)
	item, err := scanPromoSubmission(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *promoMySQLStore) insertSubmission(ctx context.Context, item PromoSubmission) (PromoSubmission, error) {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO promo_submission (
  id, campaign_id, choice_group, user_serial, order_no, order_screenshot_url,
  injection_color_note, shipping_address_enc, video_link, payment_qr_url_enc,
  status, admin_note, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.CampaignID, item.ChoiceGroup, item.UserSerial, item.OrderNo, item.OrderScreenshotURL,
		item.InjectionColorNote, item.ShippingAddressEnc, item.VideoLink, item.PaymentQrURLEnc,
		item.Status, item.AdminNote, item.CreatedAt, item.UpdatedAt,
	)
	return item, err
}

func (s *promoMySQLStore) countSubmissionsByCampaign(ctx context.Context, campaignID string) (int64, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM promo_submission WHERE campaign_id = ?`, campaignID).Scan(&count)
	return count, err
}

func (s *promoMySQLStore) listSubmissions(ctx context.Context, campaignID, status string) ([]PromoSubmission, error) {
	query := `
SELECT id, campaign_id, choice_group, user_serial, order_no, order_screenshot_url,
       injection_color_note, shipping_address_enc, video_link, payment_qr_url_enc,
       status, admin_note, created_at, updated_at
FROM promo_submission WHERE 1=1`
	args := make([]any, 0, 2)
	if campaignID != "" {
		query += " AND campaign_id = ?"
		args = append(args, campaignID)
	}
	if status != "" {
		query += " AND status = ?"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PromoSubmission, 0)
	for rows.Next() {
		item, err := scanPromoSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *promoMySQLStore) getSubmission(ctx context.Context, id string) (*PromoSubmission, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, campaign_id, choice_group, user_serial, order_no, order_screenshot_url,
       injection_color_note, shipping_address_enc, video_link, payment_qr_url_enc,
       status, admin_note, created_at, updated_at
FROM promo_submission WHERE id = ?`, id)
	item, err := scanPromoSubmission(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("记录不存在")
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *promoMySQLStore) updateSubmissionStatus(ctx context.Context, id, status, adminNote string) (*PromoSubmission, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
UPDATE promo_submission SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?`,
		status, adminNote, now, id,
	)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, errors.New("记录不存在")
	}
	return s.getSubmission(ctx, id)
}

func (s *promoMySQLStore) updateSubmissionContent(ctx context.Context, id, userSerial string, content PromoSubmission) (*PromoSubmission, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
UPDATE promo_submission
SET order_no = ?, order_screenshot_url = ?, injection_color_note = ?,
    shipping_address_enc = ?, video_link = ?, payment_qr_url_enc = ?,
    status = ?, admin_note = '', updated_at = ?
WHERE id = ? AND user_serial = ? AND status IN (?, ?)`,
		content.OrderNo, content.OrderScreenshotURL, content.InjectionColorNote,
		content.ShippingAddressEnc, content.VideoLink, content.PaymentQrURLEnc,
		PromoStatusPending, now, id, userSerial, PromoStatusPending, PromoStatusRejected,
	)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, errors.New("报名记录不存在、不属于当前用户，或已审核通过")
	}
	return s.getSubmission(ctx, id)
}
