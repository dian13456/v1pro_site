package service

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type mysqlStore struct {
	db *sql.DB
}

func openMySQLStore(dsn string) (*mysqlStore, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("MYSQL_DSN 未配置")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	store := &mysqlStore{db: db}
	if err := store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (m *mysqlStore) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

func (m *mysqlStore) migrate(ctx context.Context) error {
	schemaPath := strings.TrimSpace(os.Getenv("MYSQL_SCHEMA_PATH"))
	if schemaPath == "" {
		schemaPath = "schema.sql"
	}
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("read schema %s: %w", schemaPath, err)
	}
	for _, stmt := range splitSQLStatements(string(raw)) {
		if _, err := m.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate failed: %w\nSQL: %s", err, stmt)
		}
	}
	return nil
}

func splitSQLStatements(sqlText string) []string {
	parts := strings.Split(sqlText, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		stmt := strings.TrimSpace(part)
		if stmt == "" || strings.HasPrefix(stmt, "--") {
			continue
		}
		out = append(out, stmt)
	}
	return out
}

func (m *mysqlStore) loadLikes(ctx context.Context) (LikesStore, error) {
	store := NewEmptyLikesStore()
	rows, err := m.db.QueryContext(ctx, `SELECT resource_id, like_count FROM resource_like_counts`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceID string
		var count int
		if err := rows.Scan(&resourceID, &count); err != nil {
			return store, err
		}
		store.Counts[resourceID] = count
	}
	if err := rows.Err(); err != nil {
		return store, err
	}

	likeRows, err := m.db.QueryContext(ctx, `SELECT serial, resource_id FROM resource_device_likes`)
	if err != nil {
		return store, err
	}
	defer likeRows.Close()
	for likeRows.Next() {
		var serial, resourceID string
		if err := likeRows.Scan(&serial, &resourceID); err != nil {
			return store, err
		}
		if store.DeviceLikes[serial] == nil {
			store.DeviceLikes[serial] = map[string]bool{}
		}
		store.DeviceLikes[serial][resourceID] = true
	}
	return store, likeRows.Err()
}

func (m *mysqlStore) saveLikes(ctx context.Context, store LikesStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_device_likes`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_like_counts`); err != nil {
		return err
	}

	for resourceID, count := range store.Counts {
		if count <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO resource_like_counts (resource_id, like_count) VALUES (?, ?)`,
			resourceID, count,
		); err != nil {
			return err
		}
	}
	for serial, likedMap := range store.DeviceLikes {
		for resourceID, liked := range likedMap {
			if !liked {
				continue
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO resource_device_likes (serial, resource_id, created_at) VALUES (?, ?, ?)`,
				serial, resourceID, time.Now().Unix(),
			); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadFavorites(ctx context.Context) (FavoritesStore, error) {
	store := NewEmptyFavoritesStore()
	rows, err := m.db.QueryContext(ctx, `SELECT serial, resource_id, created_at FROM resource_favorites`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial, resourceID string
		var createdAt int64
		if err := rows.Scan(&serial, &resourceID, &createdAt); err != nil {
			return store, err
		}
		if store.DeviceFavorites[serial] == nil {
			store.DeviceFavorites[serial] = map[string]int64{}
		}
		store.DeviceFavorites[serial][resourceID] = createdAt
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveFavorites(ctx context.Context, store FavoritesStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_favorites`); err != nil {
		return err
	}
	for serial, favMap := range store.DeviceFavorites {
		for resourceID, createdAt := range favMap {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO resource_favorites (serial, resource_id, created_at) VALUES (?, ?, ?)`,
				serial, resourceID, createdAt,
			); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadDownloads(ctx context.Context) (DownloadsStore, error) {
	store := NewEmptyDownloadsStore(time.Now())
	var weekKey string
	err := m.db.QueryRowContext(ctx, `SELECT week_key FROM download_meta WHERE id = 1`).Scan(&weekKey)
	if err != nil && err != sql.ErrNoRows {
		return store, err
	}
	if strings.TrimSpace(weekKey) != "" {
		store.WeekKey = weekKey
	}

	rows, err := m.db.QueryContext(ctx, `SELECT resource_id, total_count FROM resource_download_totals`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceID string
		var count int
		if err := rows.Scan(&resourceID, &count); err != nil {
			return store, err
		}
		store.TotalCounts[resourceID] = count
	}
	if err := rows.Err(); err != nil {
		return store, err
	}

	weeklyRows, err := m.db.QueryContext(ctx,
		`SELECT resource_id, weekly_count FROM resource_download_weekly WHERE week_key = ?`, store.WeekKey,
	)
	if err != nil {
		return store, err
	}
	defer weeklyRows.Close()
	for weeklyRows.Next() {
		var resourceID string
		var count int
		if err := weeklyRows.Scan(&resourceID, &count); err != nil {
			return store, err
		}
		store.WeeklyCounts[resourceID] = count
	}
	if err := weeklyRows.Err(); err != nil {
		return store, err
	}

	windowRows, err := m.db.QueryContext(ctx,
		`SELECT serial, hour_key, day_key, hour_count, day_count FROM device_download_windows`,
	)
	if err != nil {
		return store, err
	}
	defer windowRows.Close()
	for windowRows.Next() {
		var serial string
		var window DeviceDownloadWindow
		if err := windowRows.Scan(&serial, &window.HourKey, &window.DayKey, &window.HourCount, &window.DayCount); err != nil {
			return store, err
		}
		store.DeviceWindows[serial] = window
	}
	return store, windowRows.Err()
}

func (m *mysqlStore) saveDownloads(ctx context.Context, store DownloadsStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO download_meta (id, week_key) VALUES (1, ?) ON DUPLICATE KEY UPDATE week_key = VALUES(week_key)`,
		store.WeekKey,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_download_totals`); err != nil {
		return err
	}
	for resourceID, count := range store.TotalCounts {
		if count <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO resource_download_totals (resource_id, total_count) VALUES (?, ?)`,
			resourceID, count,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_download_weekly WHERE week_key = ?`, store.WeekKey); err != nil {
		return err
	}
	for resourceID, count := range store.WeeklyCounts {
		if count <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO resource_download_weekly (week_key, resource_id, weekly_count) VALUES (?, ?, ?)`,
			store.WeekKey, resourceID, count,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM device_download_windows`); err != nil {
		return err
	}
	for serial, window := range store.DeviceWindows {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO device_download_windows (serial, hour_key, day_key, hour_count, day_count) VALUES (?, ?, ?, ?, ?)`,
			serial, window.HourKey, window.DayKey, window.HourCount, window.DayCount,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadMessages(ctx context.Context) (MessagesStore, error) {
	store := NewEmptyMessagesStore()
	rows, err := m.db.QueryContext(ctx,
		`SELECT id, serial, username, content, created_at FROM messages ORDER BY created_at ASC`,
	)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry MessageEntry
		if err := rows.Scan(&entry.ID, &entry.Serial, &entry.Username, &entry.Content, &entry.CreatedAt); err != nil {
			return store, err
		}
		store.Messages = append(store.Messages, entry)
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveMessages(ctx context.Context, store MessagesStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM messages`); err != nil {
		return err
	}
	for _, entry := range store.Messages {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO messages (id, serial, username, content, created_at) VALUES (?, ?, ?, ?, ?)`,
			entry.ID, entry.Serial, entry.Username, entry.Content, entry.CreatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadUserProfiles(ctx context.Context) (UserProfilesStore, error) {
	store := UserProfilesStore{Profiles: map[string]string{}}
	rows, err := m.db.QueryContext(ctx, `SELECT serial, display_name FROM user_profiles`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial, displayName string
		if err := rows.Scan(&serial, &displayName); err != nil {
			return store, err
		}
		store.Profiles[serial] = displayName
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveUserProfiles(ctx context.Context, store UserProfilesStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM user_profiles`); err != nil {
		return err
	}
	for serial, displayName := range store.Profiles {
		if strings.TrimSpace(displayName) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_profiles (serial, display_name) VALUES (?, ?)`,
			serial, displayName,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadAICredits(ctx context.Context) (AICreditsStore, error) {
	store := AICreditsStore{Balances: map[string]int{}}
	rows, err := m.db.QueryContext(ctx, `SELECT serial, balance FROM ai_credits`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial string
		var balance int
		if err := rows.Scan(&serial, &balance); err != nil {
			return store, err
		}
		store.Balances[serial] = balance
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveAICredits(ctx context.Context, store AICreditsStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_credits`); err != nil {
		return err
	}
	for serial, balance := range store.Balances {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ai_credits (serial, balance) VALUES (?, ?)`,
			serial, balance,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadAIShareQuota(ctx context.Context) (AIShareQuotaStore, error) {
	store := AIShareQuotaStore{Counts: map[string]int{}}
	rows, err := m.db.QueryContext(ctx, `SELECT serial, share_count FROM ai_share_counts`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial string
		var count int
		if err := rows.Scan(&serial, &count); err != nil {
			return store, err
		}
		store.Counts[serial] = count
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveAIShareQuota(ctx context.Context, store AIShareQuotaStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_share_counts`); err != nil {
		return err
	}
	for serial, count := range store.Counts {
		if count <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ai_share_counts (serial, share_count) VALUES (?, ?)`,
			serial, count,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
