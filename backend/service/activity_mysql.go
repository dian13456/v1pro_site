package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type activityMySQLStore struct {
	db *sql.DB
}

func openActivityMySQLStore(dsn string) (*activityMySQLStore, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("MYSQL_DSN 未配置")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(dbPoolSize("MYSQL_MAX_OPEN_CONNS", 20))
	db.SetMaxIdleConns(dbPoolSize("MYSQL_MAX_IDLE_CONNS", 5))
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS device_feature_access (
			serial VARCHAR(191) NOT NULL PRIMARY KEY,
			activated_at BIGINT NOT NULL DEFAULT 0
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ensure device feature access schema: %w", err)
	}
	store := &activityMySQLStore{db: db}
	if err := store.ensureTrackingNoColumn(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (m *activityMySQLStore) ensureTrackingNoColumn(ctx context.Context) error {
	var count int
	if err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'winner' AND COLUMN_NAME = 'tracking_no'`).Scan(&count); err != nil {
		return fmt.Errorf("check winner tracking_no column: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err := m.db.ExecContext(ctx, `ALTER TABLE winner ADD COLUMN tracking_no VARCHAR(128) NOT NULL DEFAULT '' AFTER shipping_status`); err != nil {
		return fmt.Errorf("add winner tracking_no column: %w", err)
	}
	return nil
}

func (m *activityMySQLStore) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

func (m *activityMySQLStore) listActivities(ctx context.Context) ([]Activity, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, title, description, rule_text, start_time, end_time, status,
		       prize_title, prize_description, prize_image, draw_hour, draw_minute,
		       winners_per_draw, shipping_days, created_at, updated_at
		FROM activity ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Activity
	for rows.Next() {
		item, scanErr := scanActivity(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanActivity(scanner interface {
	Scan(dest ...any) error
}) (Activity, error) {
	var item Activity
	var rule string
	err := scanner.Scan(
		&item.ID, &item.Title, &item.Description, &rule, &item.StartTime, &item.EndTime, &item.Status,
		&item.PrizeTitle, &item.PrizeDescription, &item.PrizeImage, &item.DrawHour, &item.DrawMinute,
		&item.WinnersPerDraw, &item.ShippingDays, &item.CreatedAt, &item.UpdatedAt,
	)
	item.Rule = rule
	return item, err
}

func (m *activityMySQLStore) getActivity(ctx context.Context, id string) (Activity, bool, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT id, title, description, rule_text, start_time, end_time, status,
		       prize_title, prize_description, prize_image, draw_hour, draw_minute,
		       winners_per_draw, shipping_days, created_at, updated_at
		FROM activity WHERE id = ?`, id)
	item, err := scanActivity(row)
	if err == sql.ErrNoRows {
		return Activity{}, false, nil
	}
	if err != nil {
		return Activity{}, false, err
	}
	return item, true, nil
}

func (m *activityMySQLStore) getActiveActivity(ctx context.Context) (Activity, bool, error) {
	now := time.Now().UnixMilli()
	row := m.db.QueryRowContext(ctx, `
		SELECT id, title, description, rule_text, start_time, end_time, status,
		       prize_title, prize_description, prize_image, draw_hour, draw_minute,
		       winners_per_draw, shipping_days, created_at, updated_at
		FROM activity
		WHERE status = ? AND start_time <= ? AND (end_time = 0 OR end_time >= ?)
		ORDER BY created_at DESC LIMIT 1`, ActivityStatusActive, now, now)
	item, err := scanActivity(row)
	if err == sql.ErrNoRows {
		return Activity{}, false, nil
	}
	if err != nil {
		return Activity{}, false, err
	}
	return item, true, nil
}

func (m *activityMySQLStore) saveActivity(ctx context.Context, activity Activity) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO activity (
			id, title, description, rule_text, start_time, end_time, status,
			prize_title, prize_description, prize_image, draw_hour, draw_minute,
			winners_per_draw, shipping_days, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			title = VALUES(title),
			description = VALUES(description),
			rule_text = VALUES(rule_text),
			start_time = VALUES(start_time),
			end_time = VALUES(end_time),
			status = VALUES(status),
			prize_title = VALUES(prize_title),
			prize_description = VALUES(prize_description),
			prize_image = VALUES(prize_image),
			draw_hour = VALUES(draw_hour),
			draw_minute = VALUES(draw_minute),
			winners_per_draw = VALUES(winners_per_draw),
			shipping_days = VALUES(shipping_days),
			updated_at = VALUES(updated_at)`,
		activity.ID, activity.Title, activity.Description, activity.Rule, activity.StartTime, activity.EndTime, activity.Status,
		activity.PrizeTitle, activity.PrizeDescription, activity.PrizeImage, activity.DrawHour, activity.DrawMinute,
		activity.WinnersPerDraw, activity.ShippingDays, activity.CreatedAt, activity.UpdatedAt,
	)
	return err
}

func (m *activityMySQLStore) countJoins(ctx context.Context, activityID string) (int64, error) {
	return m.countJoinsByPeriod(ctx, activityID, DrawPeriodKey(time.Now()))
}

func (m *activityMySQLStore) countJoinsByPeriod(ctx context.Context, activityID, period string) (int64, error) {
	var count int64
	err := m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activity_join WHERE activity_id = ? AND draw_period = ?`, activityID, period).Scan(&count)
	return count, err
}

func (m *activityMySQLStore) clearJoinsExceptPeriod(ctx context.Context, activityID, period string) (int64, error) {
	res, err := m.db.ExecContext(ctx, `DELETE FROM activity_join WHERE activity_id = ? AND draw_period <> ?`, activityID, period)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return affected, nil
}

func (m *activityMySQLStore) hasJoinInPeriod(ctx context.Context, activityID, sn, period string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM activity_join
		WHERE activity_id = ? AND sn = ? AND draw_period = ?`, activityID, sn, period).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) hasIPJoinInPeriod(ctx context.Context, activityID, userIP, period string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM activity_join
		WHERE activity_id = ? AND user_ip = ? AND draw_period = ?`, activityID, userIP, period).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) hasUserJoinedInPeriod(ctx context.Context, activityID, userSerial, period string) (bool, string, error) {
	var sn string
	err := m.db.QueryRowContext(ctx, `
		SELECT sn FROM activity_join
		WHERE activity_id = ? AND user_serial = ? AND draw_period = ?
		ORDER BY join_time DESC LIMIT 1`, activityID, userSerial, period).Scan(&sn)
	if err == sql.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return true, sn, nil
}

func (m *activityMySQLStore) addJoin(ctx context.Context, join ActivityJoin) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO activity_join (id, activity_id, sn, device_id, user_serial, user_ip, join_time, draw_period, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		join.ID, join.ActivityID, join.SN, join.DeviceID, join.UserSerial, join.UserIP, join.JoinTime, join.DrawPeriod, join.Status,
	)
	return err
}

func (m *activityMySQLStore) listJoins(ctx context.Context, activityID string, limit int) ([]ActivityJoin, error) {
	query := `
		SELECT id, activity_id, sn, device_id, user_serial, user_ip, join_time, draw_period, status
		FROM activity_join WHERE activity_id = ? ORDER BY join_time DESC`
	args := []any{activityID}
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}
	rows, err := m.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJoinRows(rows)
}

func (m *activityMySQLStore) listJoinsByPeriod(ctx context.Context, activityID, period string) ([]ActivityJoin, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, activity_id, sn, device_id, user_serial, user_ip, join_time, draw_period, status
		FROM activity_join
		WHERE activity_id = ? AND draw_period = ? AND status = ?`,
		activityID, period, JoinStatusActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJoinRows(rows)
}

func scanJoinRows(rows *sql.Rows) ([]ActivityJoin, error) {
	var out []ActivityJoin
	for rows.Next() {
		var join ActivityJoin
		if err := rows.Scan(&join.ID, &join.ActivityID, &join.SN, &join.DeviceID, &join.UserSerial, &join.UserIP, &join.JoinTime, &join.DrawPeriod, &join.Status); err != nil {
			return nil, err
		}
		out = append(out, join)
	}
	return out, rows.Err()
}

func (m *activityMySQLStore) hasWinnerSN(ctx context.Context, activityID, sn string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM winner WHERE activity_id = ? AND sn = ?`, activityID, sn).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) addWinner(ctx context.Context, winner Winner) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO winner (id, activity_id, join_id, sn, user_serial, winner_time, seed_hash, contact_status, shipping_status, tracking_no, draw_period)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		winner.ID, winner.ActivityID, winner.JoinID, winner.SN, winner.UserSerial, winner.WinnerTime, winner.SeedHash,
		winner.ContactStatus, winner.ShippingStatus, winner.TrackingNo, winner.DrawPeriod,
	)
	return err
}

func (m *activityMySQLStore) updateJoinStatus(ctx context.Context, joinID, status string) error {
	_, err := m.db.ExecContext(ctx, `UPDATE activity_join SET status = ? WHERE id = ?`, status, joinID)
	return err
}

func (m *activityMySQLStore) markJoinsLost(ctx context.Context, activityID, period string, winnerJoinIDs map[string]struct{}) error {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id FROM activity_join WHERE activity_id = ? AND draw_period = ?`, activityID, period)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var joinID string
		if err := rows.Scan(&joinID); err != nil {
			return err
		}
		status := JoinStatusLost
		if _, ok := winnerJoinIDs[joinID]; ok {
			status = JoinStatusWon
		}
		if _, err := m.db.ExecContext(ctx, `UPDATE activity_join SET status = ? WHERE id = ?`, status, joinID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (m *activityMySQLStore) hasDrawnPeriod(ctx context.Context, activityID, period string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM activity_draw_log WHERE activity_id = ? AND draw_period = ?`, activityID, period).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) addDrawLog(ctx context.Context, entry DrawLogEntry) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO activity_draw_log (activity_id, draw_period, drawn_at, join_count, winner_count, seed_hash)
		VALUES (?, ?, ?, ?, ?, ?)`,
		entry.ActivityID, entry.DrawPeriod, entry.DrawnAt, entry.JoinCount, entry.WinnerCount, entry.SeedHash,
	)
	return err
}

func (m *activityMySQLStore) getWinnerByUser(ctx context.Context, activityID, userSerial string) (Winner, bool, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT id, activity_id, join_id, sn, user_serial, winner_time, seed_hash, contact_status, shipping_status, tracking_no, draw_period
		FROM winner WHERE activity_id = ? AND user_serial = ? ORDER BY winner_time DESC LIMIT 1`, activityID, userSerial)
	return scanWinnerRow(row)
}

func (m *activityMySQLStore) getWinner(ctx context.Context, id string) (Winner, bool, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT id, activity_id, join_id, sn, user_serial, winner_time, seed_hash, contact_status, shipping_status, tracking_no, draw_period
		FROM winner WHERE id = ?`, id)
	return scanWinnerRow(row)
}

func scanWinnerRow(row *sql.Row) (Winner, bool, error) {
	var winner Winner
	err := row.Scan(&winner.ID, &winner.ActivityID, &winner.JoinID, &winner.SN, &winner.UserSerial, &winner.WinnerTime,
		&winner.SeedHash, &winner.ContactStatus, &winner.ShippingStatus, &winner.TrackingNo, &winner.DrawPeriod)
	if err == sql.ErrNoRows {
		return Winner{}, false, nil
	}
	if err != nil {
		return Winner{}, false, err
	}
	return winner, true, nil
}

func (m *activityMySQLStore) listWinners(ctx context.Context, activityID string) ([]Winner, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, activity_id, join_id, sn, user_serial, winner_time, seed_hash, contact_status, shipping_status, tracking_no, draw_period
		FROM winner WHERE activity_id = ? ORDER BY winner_time DESC`, activityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Winner
	for rows.Next() {
		var winner Winner
		if err := rows.Scan(&winner.ID, &winner.ActivityID, &winner.JoinID, &winner.SN, &winner.UserSerial, &winner.WinnerTime,
			&winner.SeedHash, &winner.ContactStatus, &winner.ShippingStatus, &winner.TrackingNo, &winner.DrawPeriod); err != nil {
			return nil, err
		}
		out = append(out, winner)
	}
	return out, rows.Err()
}

func (m *activityMySQLStore) updateWinnerShipping(ctx context.Context, id, shippingStatus, trackingNo string) error {
	if strings.TrimSpace(trackingNo) == "" {
		_, err := m.db.ExecContext(ctx, `UPDATE winner SET shipping_status = ? WHERE id = ?`, shippingStatus, id)
		return err
	}
	_, err := m.db.ExecContext(ctx, `UPDATE winner SET shipping_status = ?, tracking_no = ? WHERE id = ?`, shippingStatus, trackingNo, id)
	return err
}

func (m *activityMySQLStore) updateWinnerContact(ctx context.Context, id, contactStatus string) error {
	_, err := m.db.ExecContext(ctx, `UPDATE winner SET contact_status = ? WHERE id = ?`, contactStatus, id)
	return err
}

func (m *activityMySQLStore) hasWinnerInfo(ctx context.Context, winnerID string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM winner_info WHERE winner_id = ?`, winnerID).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) addWinnerInfo(ctx context.Context, info WinnerInfo) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO winner_info (id, winner_id, name_enc, phone_enc, wechat_enc, qq_enc, province, city, address_enc, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		info.ID, info.WinnerID, info.NameEnc, info.PhoneEnc, info.WechatEnc, info.QQEnc, info.Province, info.City, info.AddressEnc, info.CreatedAt,
	)
	return err
}

func (m *activityMySQLStore) getWinnerInfo(ctx context.Context, winnerID string) (WinnerInfo, bool, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT id, winner_id, name_enc, phone_enc, wechat_enc, qq_enc, province, city, address_enc, created_at
		FROM winner_info WHERE winner_id = ?`, winnerID)
	var info WinnerInfo
	err := row.Scan(&info.ID, &info.WinnerID, &info.NameEnc, &info.PhoneEnc, &info.WechatEnc, &info.QQEnc, &info.Province, &info.City, &info.AddressEnc, &info.CreatedAt)
	if err == sql.ErrNoRows {
		return WinnerInfo{}, false, nil
	}
	if err != nil {
		return WinnerInfo{}, false, err
	}
	return info, true, nil
}

func (m *activityMySQLStore) isRegisteredDevice(ctx context.Context, sn string) (bool, error) {
	var count int
	err := m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM device_registry WHERE serial = ?`, sn).Scan(&count)
	return count > 0, err
}

func (m *activityMySQLStore) registerDevice(ctx context.Context, entry DeviceRegistryEntry) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO device_registry (serial, source, created_at)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE source = VALUES(source)`, entry.Serial, entry.Source, entry.CreatedAt)
	return err
}

func (m *activityMySQLStore) getDevice(ctx context.Context, sn string) (DeviceRegistryEntry, bool, error) {
	var entry DeviceRegistryEntry
	err := m.db.QueryRowContext(ctx, `
		SELECT d.serial, d.source, d.created_at, COALESCE(a.activated_at, 0)
		FROM device_registry d
		LEFT JOIN device_feature_access a ON a.serial = d.serial
		WHERE d.serial = ?`, sn).Scan(&entry.Serial, &entry.Source, &entry.CreatedAt, &entry.ActivatedAt)
	if err == sql.ErrNoRows {
		return DeviceRegistryEntry{}, false, nil
	}
	return entry, err == nil, err
}

func (m *activityMySQLStore) activateDeviceFeatures(ctx context.Context, sn string, activatedAt int64) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO device_feature_access (serial, activated_at)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE activated_at = IF(activated_at > 0, activated_at, VALUES(activated_at))`, sn, activatedAt)
	return err
}

func (m *activityMySQLStore) listDevices(ctx context.Context, limit int) ([]DeviceRegistryEntry, error) {
	query := `SELECT d.serial, d.source, d.created_at, COALESCE(a.activated_at, 0)
		FROM device_registry d LEFT JOIN device_feature_access a ON a.serial = d.serial
		ORDER BY d.created_at DESC`
	args := []any{}
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}
	rows, err := m.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeviceRegistryEntry
	for rows.Next() {
		var entry DeviceRegistryEntry
		if err := rows.Scan(&entry.Serial, &entry.Source, &entry.CreatedAt, &entry.ActivatedAt); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}
