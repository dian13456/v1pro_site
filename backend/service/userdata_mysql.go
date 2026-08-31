package service

import (
	"context"
	"database/sql"
	"errors"
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
	// Keep this additive migration in the binary as production deployments only
	// replace jiadian-api and intentionally leave the server schema file intact.
	if _, err := m.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS user_avatars (
		serial VARCHAR(191) NOT NULL PRIMARY KEY,
		avatar_key VARCHAR(512) NOT NULL
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return fmt.Errorf("migrate user avatars failed: %w", err)
	}
	if _, err := m.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS user_profile_avatars (
		serial VARCHAR(191) NOT NULL PRIMARY KEY,
		object_key VARCHAR(512) NOT NULL,
		updated_at BIGINT NOT NULL DEFAULT 0,
		KEY idx_profile_avatar_updated (updated_at DESC)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return fmt.Errorf("migrate profile avatars failed: %w", err)
	}
	if _, err := m.db.ExecContext(ctx, `
		INSERT IGNORE INTO user_profile_avatars (serial, object_key, updated_at)
		SELECT serial, avatar_key, 0 FROM user_avatars WHERE avatar_key <> ''`); err != nil {
		return fmt.Errorf("migrate legacy profile avatars failed: %w", err)
	}
	if _, err := m.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS blocked_uploaders (
		viewer_serial VARCHAR(191) NOT NULL,
		blocked_serial VARCHAR(191) NOT NULL,
		created_at BIGINT NOT NULL DEFAULT 0,
		PRIMARY KEY (viewer_serial, blocked_serial),
		KEY idx_blocked_viewer_created (viewer_serial, created_at DESC)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return fmt.Errorf("migrate blocked uploaders failed: %w", err)
	}
	if _, err := m.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS followed_uploaders (
		viewer_serial VARCHAR(191) NOT NULL,
		followed_serial VARCHAR(191) NOT NULL,
		created_at BIGINT NOT NULL DEFAULT 0,
		PRIMARY KEY (viewer_serial, followed_serial),
		KEY idx_followed_viewer_created (viewer_serial, created_at DESC)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return fmt.Errorf("migrate followed uploaders failed: %w", err)
	}
	var resourceIDColumnCount int
	if err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'resource_id'
	`).Scan(&resourceIDColumnCount); err != nil {
		return fmt.Errorf("check messages resource_id column failed: %w", err)
	}
	if resourceIDColumnCount == 0 {
		if _, err := m.db.ExecContext(ctx, `ALTER TABLE messages ADD COLUMN resource_id VARCHAR(64) NOT NULL DEFAULT '' AFTER id`); err != nil {
			return fmt.Errorf("migrate messages resource_id failed: %w", err)
		}
	}
	var extraQuotaColumnCount int
	if err := m.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_share_counts' AND COLUMN_NAME = 'extra_quota'
	`).Scan(&extraQuotaColumnCount); err != nil {
		return fmt.Errorf("check ai_share_counts extra_quota column failed: %w", err)
	}
	if extraQuotaColumnCount == 0 {
		if _, err := m.db.ExecContext(ctx, `ALTER TABLE ai_share_counts ADD COLUMN extra_quota INT NOT NULL DEFAULT 0 AFTER share_count`); err != nil {
			return fmt.Errorf("migrate ai_share_counts extra_quota failed: %w", err)
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

func (m *mysqlStore) applyDeviceLike(ctx context.Context, serial, resourceID string) (DeviceLikeResult, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return DeviceLikeResult{}, err
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(
		ctx,
		`INSERT INTO resource_device_likes (serial, resource_id, created_at) VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE serial = serial`,
		serial, resourceID, time.Now().Unix(),
	)
	if err != nil {
		return DeviceLikeResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return DeviceLikeResult{}, err
	}
	// MySQL ON DUPLICATE KEY UPDATE: RowsAffected is 1 for insert, 2 for update, 0 if values unchanged.
	alreadyLiked := affected == 0 || affected == 2
	if !alreadyLiked {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO resource_like_counts (resource_id, like_count) VALUES (?, 1)
			 ON DUPLICATE KEY UPDATE like_count = like_count + 1`,
			resourceID,
		); err != nil {
			return DeviceLikeResult{}, err
		}
	}

	var likeCount int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT like_count FROM resource_like_counts WHERE resource_id = ?`,
		resourceID,
	).Scan(&likeCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			likeCount = 0
		} else {
			return DeviceLikeResult{}, err
		}
	}
	if likeCount < 0 {
		likeCount = 0
	}
	if err := tx.Commit(); err != nil {
		return DeviceLikeResult{}, err
	}
	return DeviceLikeResult{AlreadyLiked: alreadyLiked, LikeCount: likeCount}, nil
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
	countRows, err := m.db.QueryContext(ctx, `SELECT resource_id, favorite_count FROM resource_favorite_counts`)
	if err != nil {
		return store, err
	}
	defer countRows.Close()
	for countRows.Next() {
		var resourceID string
		var count int
		if err := countRows.Scan(&resourceID, &count); err != nil {
			return store, err
		}
		store.Counts[resourceID] = count
	}
	if err := countRows.Err(); err != nil {
		return store, err
	}

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
	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_favorite_counts`); err != nil {
		return err
	}

	for resourceID, count := range store.Counts {
		if count <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO resource_favorite_counts (resource_id, favorite_count) VALUES (?, ?)`,
			resourceID, count,
		); err != nil {
			return err
		}
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

func (m *mysqlStore) listBlockedUploaders(ctx context.Context, serial string) ([]string, error) {
	rows, err := m.db.QueryContext(ctx,
		`SELECT blocked_serial FROM blocked_uploaders WHERE viewer_serial = ? ORDER BY created_at DESC, blocked_serial DESC`,
		serial,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var blockedSerial string
		if err := rows.Scan(&blockedSerial); err != nil {
			return nil, err
		}
		ids = append(ids, blockedSerial)
	}
	return ids, rows.Err()
}

func (m *mysqlStore) setUploaderBlocked(ctx context.Context, serial, uploaderSerial string, blocked bool) ([]string, error) {
	if blocked {
		_, err := m.db.ExecContext(ctx,
			`INSERT INTO blocked_uploaders (viewer_serial, blocked_serial, created_at) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
			serial, uploaderSerial, time.Now().Unix(),
		)
		if err != nil {
			return nil, err
		}
	} else if _, err := m.db.ExecContext(ctx,
		`DELETE FROM blocked_uploaders WHERE viewer_serial = ? AND blocked_serial = ?`,
		serial, uploaderSerial,
	); err != nil {
		return nil, err
	}
	return m.listBlockedUploaders(ctx, serial)
}

func (m *mysqlStore) listFollowedUploaders(ctx context.Context, serial string) ([]string, error) {
	rows, err := m.db.QueryContext(ctx,
		`SELECT followed_serial FROM followed_uploaders WHERE viewer_serial = ? ORDER BY created_at DESC, followed_serial DESC`,
		serial,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var followedSerial string
		if err := rows.Scan(&followedSerial); err != nil {
			return nil, err
		}
		ids = append(ids, followedSerial)
	}
	return ids, rows.Err()
}

func (m *mysqlStore) setUploaderFollowed(ctx context.Context, serial, uploaderSerial string, followed bool) ([]string, error) {
	if followed {
		_, err := m.db.ExecContext(ctx,
			`INSERT INTO followed_uploaders (viewer_serial, followed_serial, created_at) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
			serial, uploaderSerial, time.Now().Unix(),
		)
		if err != nil {
			return nil, err
		}
	} else if _, err := m.db.ExecContext(ctx,
		`DELETE FROM followed_uploaders WHERE viewer_serial = ? AND followed_serial = ?`,
		serial, uploaderSerial,
	); err != nil {
		return nil, err
	}
	return m.listFollowedUploaders(ctx, serial)
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

func (m *mysqlStore) recordResourceInteraction(ctx context.Context, serial, resourceID, action string, now time.Time) error {
	_, err := m.db.ExecContext(ctx,
		`INSERT INTO resource_interactions (serial, resource_id, action, action_count, last_at)
		 VALUES (?, ?, ?, 1, ?)
		 ON DUPLICATE KEY UPDATE action_count = LEAST(action_count + 1, 1000000), last_at = VALUES(last_at)`,
		serial, resourceID, action, now.Unix(),
	)
	return err
}

func (m *mysqlStore) listResourceInteractions(ctx context.Context, serial string, limit int) ([]ResourceInteraction, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := m.db.QueryContext(ctx,
		`SELECT resource_id, action, action_count, last_at
		 FROM resource_interactions WHERE serial = ? ORDER BY last_at DESC LIMIT ?`,
		serial, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ResourceInteraction, 0)
	for rows.Next() {
		var interaction ResourceInteraction
		if err := rows.Scan(&interaction.ResourceID, &interaction.Action, &interaction.ActionCount, &interaction.LastAt); err != nil {
			return nil, err
		}
		result = append(result, interaction)
	}
	return result, rows.Err()
}

func (m *mysqlStore) deleteResourceInteractions(ctx context.Context, resourceID string) error {
	_, err := m.db.ExecContext(ctx, `DELETE FROM resource_interactions WHERE resource_id = ?`, resourceID)
	return err
}

func (m *mysqlStore) loadMessages(ctx context.Context) (MessagesStore, error) {
	store := NewEmptyMessagesStore()
	rows, err := m.db.QueryContext(ctx,
		`SELECT id, resource_id, serial, username, content, created_at FROM messages ORDER BY created_at ASC`,
	)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry MessageEntry
		if err := rows.Scan(&entry.ID, &entry.ResourceID, &entry.Serial, &entry.Username, &entry.Content, &entry.CreatedAt); err != nil {
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
			`INSERT INTO messages (id, resource_id, serial, username, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			entry.ID, entry.ResourceID, entry.Serial, entry.Username, entry.Content, entry.CreatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadUserProfiles(ctx context.Context) (UserProfilesStore, error) {
	store := UserProfilesStore{Profiles: map[string]string{}, Avatars: map[string]string{}}
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
	if err := rows.Err(); err != nil {
		return store, err
	}
	if err := rows.Close(); err != nil {
		return store, err
	}
	avatarRows, err := m.db.QueryContext(ctx, `SELECT serial, object_key FROM user_profile_avatars`)
	if err != nil {
		return store, err
	}
	defer avatarRows.Close()
	for avatarRows.Next() {
		var serial, objectKey string
		if err := avatarRows.Scan(&serial, &objectKey); err != nil {
			return store, err
		}
		if strings.TrimSpace(objectKey) != "" {
			store.Avatars[serial] = objectKey
		}
	}
	return store, avatarRows.Err()
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_profile_avatars`); err != nil {
		return err
	}
	for serial, objectKey := range store.Avatars {
		if strings.TrimSpace(objectKey) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_profile_avatars (serial, object_key, updated_at) VALUES (?, ?, ?)`,
			serial, objectKey, time.Now().UnixMilli(),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadUserPromptPrefs(ctx context.Context) (UserPromptPrefsStore, error) {
	store := UserPromptPrefsStore{SoftwareDismissed: map[string]int64{}}
	rows, err := m.db.QueryContext(ctx, `SELECT serial, software_dismissed_id FROM user_prompt_prefs`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial string
		var resourceID int64
		if err := rows.Scan(&serial, &resourceID); err != nil {
			return store, err
		}
		if resourceID > 0 {
			store.SoftwareDismissed[serial] = resourceID
		}
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveUserPromptPrefs(ctx context.Context, store UserPromptPrefsStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM user_prompt_prefs`); err != nil {
		return err
	}
	for serial, resourceID := range store.SoftwareDismissed {
		if resourceID <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_prompt_prefs (serial, software_dismissed_id) VALUES (?, ?)`,
			serial, resourceID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) getStorageMeta(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := m.db.QueryRowContext(ctx, `SELECT meta_value FROM storage_meta WHERE meta_key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (m *mysqlStore) setStorageMetaTx(ctx context.Context, tx *sql.Tx, key, value string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO storage_meta (meta_key, meta_value) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`, key, value)
	return err
}

func (m *mysqlStore) ensureCreditUnitScale(ctx context.Context) error {
	const creditsMetaKey = "ai_credits_unit_scale"
	const ledgerMetaKey = "ai_credit_ledger_unit_scale"
	scaleValue := fmt.Sprintf("%d", CreditUnitScale)

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	migrateOne := func(metaKey, updateSQL string) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO storage_meta (meta_key, meta_value) VALUES (?, '0')
			ON DUPLICATE KEY UPDATE meta_value = meta_value`, metaKey); err != nil {
			return err
		}
		var current string
		if err := tx.QueryRowContext(ctx,
			`SELECT meta_value FROM storage_meta WHERE meta_key = ? FOR UPDATE`, metaKey,
		).Scan(&current); err != nil {
			return err
		}
		if strings.TrimSpace(current) == scaleValue {
			return nil
		}
		if _, err := tx.ExecContext(ctx, updateSQL, CreditUnitScale); err != nil {
			return err
		}
		return m.setStorageMetaTx(ctx, tx, metaKey, scaleValue)
	}

	if err := migrateOne(creditsMetaKey, `UPDATE ai_credits SET balance = balance * ?`); err != nil {
		return err
	}
	if err := migrateOne(ledgerMetaKey, `UPDATE ai_credit_ledger SET amount = amount * ?`); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *mysqlStore) loadAICredits(ctx context.Context) (AICreditsStore, error) {
	if err := m.ensureCreditUnitScale(ctx); err != nil {
		return AICreditsStore{}, err
	}
	store := AICreditsStore{UnitScale: CreditUnitScale, Balances: map[string]int{}}
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
	if err := rows.Err(); err != nil {
		return store, err
	}
	store.ensureUnitScale()
	return store, nil
}

func (m *mysqlStore) saveAICredits(ctx context.Context, store AICreditsStore) error {
	store.ensureUnitScale()
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
	if err := m.setStorageMetaTx(ctx, tx, "ai_credits_unit_scale", fmt.Sprintf("%d", CreditUnitScale)); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *mysqlStore) loadCreditLikeGrants(ctx context.Context) (CreditLikeGrantStore, error) {
	store := NewCreditLikeGrantStore()
	rows, err := m.db.QueryContext(ctx, `SELECT resource_id, liker_serial FROM credit_like_grants`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceID, likerSerial string
		if err := rows.Scan(&resourceID, &likerSerial); err != nil {
			return store, err
		}
		store.Grants[likeGrantKey(resourceID, likerSerial)] = true
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveCreditLikeGrants(ctx context.Context, store CreditLikeGrantStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM credit_like_grants`); err != nil {
		return err
	}
	now := time.Now().UTC().UnixMilli()
	for key, granted := range store.Grants {
		if !granted {
			continue
		}
		parts := strings.SplitN(key, "|", 2)
		if len(parts) != 2 {
			continue
		}
		resourceID := strings.TrimSpace(parts[0])
		likerSerial := NormalizeRewardSerial(parts[1])
		if resourceID == "" || likerSerial == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO credit_like_grants (resource_id, liker_serial, created_at)
			VALUES (?, ?, ?)`, resourceID, likerSerial, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) loadCreditDailyRewards(ctx context.Context) (CreditDailyRewardStore, error) {
	store := NewCreditDailyRewardStore()
	dayKey := ChinaDayKey(time.Now())
	store.DayKey = dayKey

	totalRows, err := m.db.QueryContext(ctx, `
		SELECT kind, beneficiary_serial, amount_units
		FROM credit_daily_reward_totals
		WHERE day_key = ?`, dayKey)
	if err != nil {
		return store, err
	}
	defer totalRows.Close()
	for totalRows.Next() {
		var kind, beneficiary string
		var amount int
		if err := totalRows.Scan(&kind, &beneficiary, &amount); err != nil {
			return store, err
		}
		store.Totals[dailyTotalKey(kind, beneficiary)] = amount
	}
	if err := totalRows.Err(); err != nil {
		return store, err
	}

	eventRows, err := m.db.QueryContext(ctx, `
		SELECT kind, event_id
		FROM credit_daily_reward_events
		WHERE day_key = ?`, dayKey)
	if err != nil {
		return store, err
	}
	defer eventRows.Close()
	for eventRows.Next() {
		var kind, eventID string
		if err := eventRows.Scan(&kind, &eventID); err != nil {
			return store, err
		}
		store.Events[dailyEventKey(kind, eventID)] = true
	}
	return store, eventRows.Err()
}

func (m *mysqlStore) saveCreditDailyRewards(ctx context.Context, store CreditDailyRewardStore) error {
	dayKey := strings.TrimSpace(store.DayKey)
	if dayKey == "" {
		dayKey = ChinaDayKey(time.Now())
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM credit_daily_reward_totals WHERE day_key = ?`, dayKey); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM credit_daily_reward_events WHERE day_key = ?`, dayKey); err != nil {
		return err
	}
	now := time.Now().UTC().UnixMilli()
	for key, amount := range store.Totals {
		if amount <= 0 {
			continue
		}
		parts := strings.SplitN(key, "|", 2)
		if len(parts) != 2 {
			continue
		}
		kind := strings.TrimSpace(parts[0])
		beneficiary := NormalizeRewardSerial(parts[1])
		if kind == "" || beneficiary == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO credit_daily_reward_totals (day_key, kind, beneficiary_serial, amount_units)
			VALUES (?, ?, ?, ?)`, dayKey, kind, beneficiary, amount); err != nil {
			return err
		}
	}
	for key, ok := range store.Events {
		if !ok {
			continue
		}
		parts := strings.SplitN(key, "|", 2)
		if len(parts) != 2 {
			continue
		}
		kind := strings.TrimSpace(parts[0])
		eventID := strings.TrimSpace(parts[1])
		if kind == "" || eventID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO credit_daily_reward_events
			(day_key, kind, event_id, beneficiary_serial, amount_units, created_at)
			VALUES (?, ?, ?, '', 0, ?)`, dayKey, kind, eventID, now); err != nil {
			return err
		}
	}
	// Drop stale days to keep the tables small.
	if _, err := tx.ExecContext(ctx, `DELETE FROM credit_daily_reward_totals WHERE day_key <> ?`, dayKey); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM credit_daily_reward_events WHERE day_key <> ?`, dayKey); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *mysqlStore) loadAIShareQuota(ctx context.Context) (AIShareQuotaStore, error) {
	store := newAIShareQuotaStore()
	rows, err := m.db.QueryContext(ctx, `SELECT serial, share_count, extra_quota FROM ai_share_counts`)
	if err != nil {
		return store, err
	}
	defer rows.Close()
	for rows.Next() {
		var serial string
		var count, extraQuota int
		if err := rows.Scan(&serial, &count, &extraQuota); err != nil {
			return store, err
		}
		serial = normalizeAIShareQuotaSerial(serial)
		if serial == "" {
			continue
		}
		if count > 0 {
			store.Counts[serial] += count
		}
		if extraQuota > 0 {
			store.ExtraQuota[serial] += extraQuota
		}
	}
	return store, rows.Err()
}

func (m *mysqlStore) saveAIShareQuota(ctx context.Context, store AIShareQuotaStore) error {
	store = store.Clone()
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_share_counts`); err != nil {
		return err
	}
	serials := make(map[string]struct{}, len(store.Counts)+len(store.ExtraQuota))
	for serial := range store.Counts {
		serials[serial] = struct{}{}
	}
	for serial := range store.ExtraQuota {
		serials[serial] = struct{}{}
	}
	for serial := range serials {
		count := store.ShareCount(serial)
		extraQuota := store.ExtraShareQuota(serial)
		if count <= 0 && extraQuota <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ai_share_counts (serial, share_count, extra_quota) VALUES (?, ?, ?)`,
			serial, count, extraQuota,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) resetAIShareRemainingToBase(ctx context.Context, serial string) (int, error) {
	serial = normalizeAIShareQuotaSerial(serial)
	if serial == "" {
		return 0, fmt.Errorf("serial empty")
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT share_count
		FROM ai_share_counts
		WHERE UPPER(TRIM(serial)) = ?
		FOR UPDATE
	`, serial)
	if err != nil {
		return 0, err
	}
	count := 0
	for rows.Next() {
		var storedCount int
		if err := rows.Scan(&storedCount); err != nil {
			_ = rows.Close()
			return 0, err
		}
		if storedCount > 0 {
			count += storedCount
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_share_counts WHERE UPPER(TRIM(serial)) = ?`, serial); err != nil {
		return 0, err
	}
	if count > 0 {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ai_share_counts (serial, share_count, extra_quota) VALUES (?, ?, ?)`,
			serial, count, count,
		); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

func (m *mysqlStore) loadAIShareUnlimited(ctx context.Context) (AIShareUnlimitedStore, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT serial FROM ai_share_unlimited_serials`)
	if err != nil {
		return AIShareUnlimitedStore{serialSet: map[string]struct{}{}}, err
	}
	defer rows.Close()
	serials := make([]string, 0)
	for rows.Next() {
		var serial string
		if err := rows.Scan(&serial); err != nil {
			return AIShareUnlimitedStore{serialSet: map[string]struct{}{}}, err
		}
		serials = append(serials, serial)
	}
	if err := rows.Err(); err != nil {
		return AIShareUnlimitedStore{serialSet: map[string]struct{}{}}, err
	}
	return NewAIShareUnlimitedStore(serials...), nil
}

func (m *mysqlStore) saveAIShareUnlimited(ctx context.Context, store AIShareUnlimitedStore) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_share_unlimited_serials`); err != nil {
		return err
	}
	for _, serial := range store.Serials() {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ai_share_unlimited_serials (serial) VALUES (?)`,
			serial,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *mysqlStore) appendCreditLedgerEntry(ctx context.Context, entry CreditLedgerEntry) error {
	if err := m.ensureCreditUnitScale(ctx); err != nil {
		return err
	}
	createdAt := time.Now().UTC().UnixMilli()
	if entry.CreatedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, entry.CreatedAt); err == nil {
			createdAt = parsed.UnixMilli()
		}
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ai_credit_ledger (id, serial, amount, source, label, ref_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		entry.ID,
		strings.TrimSpace(entry.Serial),
		entry.Amount,
		strings.TrimSpace(entry.Source),
		strings.TrimSpace(entry.Label),
		strings.TrimSpace(entry.RefID),
		createdAt,
	); err != nil {
		return err
	}
	if err := m.setStorageMetaTx(ctx, tx, "ai_credit_ledger_unit_scale", fmt.Sprintf("%d", CreditUnitScale)); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *mysqlStore) listCreditLedger(ctx context.Context, serial string, limit int) ([]CreditLedgerEntry, error) {
	if err := m.ensureCreditUnitScale(ctx); err != nil {
		return nil, err
	}
	serial = strings.TrimSpace(serial)
	if serial == "" {
		return []CreditLedgerEntry{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, amount, source, label, ref_id, created_at
		FROM ai_credit_ledger
		WHERE serial = ?
		ORDER BY created_at DESC
		LIMIT ?`, serial, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CreditLedgerEntry, 0, limit)
	for rows.Next() {
		var entry CreditLedgerEntry
		var createdAt int64
		if err := rows.Scan(&entry.ID, &entry.Amount, &entry.Source, &entry.Label, &entry.RefID, &createdAt); err != nil {
			return nil, err
		}
		entry.CreatedAt = time.UnixMilli(createdAt).UTC().Format(time.RFC3339)
		out = append(out, entry)
	}
	return out, rows.Err()
}
