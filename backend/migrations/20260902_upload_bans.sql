-- Global administrator upload bans.  Active bans are represented by rows;
-- removing a row unbans the uploader.  Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS upload_bans (
  serial VARCHAR(191) NOT NULL PRIMARY KEY,
  reason VARCHAR(512) NOT NULL DEFAULT '',
  admin_actor VARCHAR(191) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  KEY idx_upload_bans_updated (updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
