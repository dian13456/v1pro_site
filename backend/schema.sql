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

CREATE TABLE IF NOT EXISTS resource_favorite_counts (
  resource_id VARCHAR(64) NOT NULL PRIMARY KEY,
  favorite_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blocked_uploaders (
  viewer_serial VARCHAR(191) NOT NULL,
  blocked_serial VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (viewer_serial, blocked_serial),
  KEY idx_blocked_viewer_created (viewer_serial, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS followed_uploaders (
  viewer_serial VARCHAR(191) NOT NULL,
  followed_serial VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (viewer_serial, followed_serial),
  KEY idx_followed_viewer_created (viewer_serial, created_at DESC)
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

CREATE TABLE IF NOT EXISTS resource_interactions (
  serial VARCHAR(191) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  action VARCHAR(20) NOT NULL,
  action_count INT NOT NULL DEFAULT 1,
  last_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (serial, resource_id, action),
  KEY idx_resource_interactions_serial_last (serial, last_at DESC),
  KEY idx_resource_interactions_resource_action (resource_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  resource_id VARCHAR(64) NOT NULL DEFAULT '',
  serial VARCHAR(191) NOT NULL DEFAULT '',
  username VARCHAR(128) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_messages_created (created_at DESC),
  KEY idx_messages_resource_created (resource_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_profiles (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  display_name VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_profile_avatars (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  object_key VARCHAR(512) NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_profile_avatar_updated (updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_prompt_prefs (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  software_dismissed_id BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_credits (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  balance INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS storage_meta (
  meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_like_grants (
  resource_id VARCHAR(64) NOT NULL,
  liker_serial VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (resource_id, liker_serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_daily_reward_events (
  day_key VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  beneficiary_serial VARCHAR(191) NOT NULL,
  amount_units INT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (day_key, kind, event_id),
  KEY idx_daily_reward_beneficiary (day_key, kind, beneficiary_serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_daily_reward_totals (
  day_key VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  beneficiary_serial VARCHAR(191) NOT NULL,
  amount_units INT NOT NULL,
  PRIMARY KEY (day_key, kind, beneficiary_serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_share_counts (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  share_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_share_unlimited_serials (
  serial VARCHAR(191) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_credit_ledger (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  serial VARCHAR(191) NOT NULL,
  amount INT NOT NULL,
  source VARCHAR(32) NOT NULL,
  label VARCHAR(255) NOT NULL,
  ref_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  KEY idx_credit_ledger_serial_created (serial, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Activity lottery module
CREATE TABLE IF NOT EXISTS activity (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  start_time BIGINT NOT NULL DEFAULT 0,
  end_time BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  prize_title VARCHAR(255) NOT NULL DEFAULT '',
  prize_description TEXT,
  prize_image VARCHAR(512) NOT NULL DEFAULT '',
  draw_hour INT NOT NULL DEFAULT 20,
  draw_minute INT NOT NULL DEFAULT 0,
  winners_per_draw INT NOT NULL DEFAULT 1,
  shipping_days INT NOT NULL DEFAULT 7,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_activity_status (status, start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity_join (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  activity_id VARCHAR(64) NOT NULL,
  sn VARCHAR(191) NOT NULL,
  device_id VARCHAR(191) NOT NULL DEFAULT '',
  user_serial VARCHAR(191) NOT NULL DEFAULT '',
  user_ip VARCHAR(64) NOT NULL DEFAULT '',
  join_time BIGINT NOT NULL DEFAULT 0,
  draw_period VARCHAR(16) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  KEY idx_join_activity_period (activity_id, draw_period),
  KEY idx_join_sn_period (activity_id, sn, draw_period),
  KEY idx_join_ip_period (activity_id, user_ip, draw_period),
  KEY idx_join_time (join_time DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS winner (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  activity_id VARCHAR(64) NOT NULL,
  join_id VARCHAR(64) NOT NULL,
  sn VARCHAR(191) NOT NULL,
  user_serial VARCHAR(191) NOT NULL DEFAULT '',
  winner_time BIGINT NOT NULL DEFAULT 0,
  seed_hash VARCHAR(128) NOT NULL DEFAULT '',
  contact_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  shipping_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  tracking_no VARCHAR(128) NOT NULL DEFAULT '',
  draw_period VARCHAR(16) NOT NULL DEFAULT '',
  KEY idx_winner_activity (activity_id, winner_time DESC),
  KEY idx_winner_sn (activity_id, sn),
  KEY idx_winner_user (activity_id, user_serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS winner_info (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  winner_id VARCHAR(64) NOT NULL UNIQUE,
  name_enc TEXT NOT NULL,
  phone_enc TEXT NOT NULL,
  wechat_enc TEXT NOT NULL,
  qq_enc TEXT NOT NULL,
  province VARCHAR(64) NOT NULL DEFAULT '',
  city VARCHAR(64) NOT NULL DEFAULT '',
  address_enc TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_registry (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  source VARCHAR(64) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_feature_access (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  activated_at BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity_draw_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  activity_id VARCHAR(64) NOT NULL,
  draw_period VARCHAR(16) NOT NULL,
  drawn_at BIGINT NOT NULL DEFAULT 0,
  join_count INT NOT NULL DEFAULT 0,
  winner_count INT NOT NULL DEFAULT 0,
  seed_hash VARCHAR(128) NOT NULL DEFAULT '',
  UNIQUE KEY uk_activity_draw_period (activity_id, draw_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mall_product (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_urls MEDIUMTEXT NULL,
  price_cents BIGINT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'on_sale',
  sort_order INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_mall_product_status (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mall_order (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_serial VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_pay',
  items_json MEDIUMTEXT NOT NULL,
  total_cents BIGINT NOT NULL DEFAULT 0,
  name_enc TEXT NOT NULL,
  phone_enc TEXT NOT NULL,
  wechat_enc TEXT NOT NULL,
  qq_enc TEXT NOT NULL,
  province VARCHAR(64) NOT NULL DEFAULT '',
  city VARCHAR(64) NOT NULL DEFAULT '',
  address_enc TEXT NOT NULL,
  tracking_no VARCHAR(128) NOT NULL DEFAULT '',
  remark VARCHAR(512) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  paid_at BIGINT NOT NULL DEFAULT 0,
  shipped_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_mall_order_user (user_serial, created_at DESC),
  KEY idx_mall_order_status (status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
