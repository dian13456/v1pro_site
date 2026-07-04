-- jiadian_hub user data schema (MySQL 8.0+ / MariaDB 10.5+)
-- Charset: utf8mb4

CREATE TABLE IF NOT EXISTS resource_like_counts (
  resource_id VARCHAR(64) NOT NULL PRIMARY KEY,
  like_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resource_device_likes (
  serial VARCHAR(191) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (serial, resource_id),
  KEY idx_device_likes_serial (serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resource_favorites (
  serial VARCHAR(191) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (serial, resource_id),
  KEY idx_favorites_serial_created (serial, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS download_meta (
  id TINYINT NOT NULL PRIMARY KEY,
  week_key VARCHAR(16) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO download_meta (id, week_key) VALUES (1, '1970-W01')
  ON DUPLICATE KEY UPDATE week_key = week_key;

CREATE TABLE IF NOT EXISTS resource_download_totals (
  resource_id VARCHAR(64) NOT NULL PRIMARY KEY,
  total_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resource_download_weekly (
  week_key VARCHAR(16) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  weekly_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (week_key, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_download_windows (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  hour_key VARCHAR(32) NOT NULL DEFAULT '',
  day_key VARCHAR(16) NOT NULL DEFAULT '',
  hour_count INT NOT NULL DEFAULT 0,
  day_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  serial VARCHAR(191) NOT NULL DEFAULT '',
  username VARCHAR(128) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_messages_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_profiles (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  display_name VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_prompt_prefs (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  software_dismissed_id BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_credits (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  balance INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_share_counts (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  share_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
