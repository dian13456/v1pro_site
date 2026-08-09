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
