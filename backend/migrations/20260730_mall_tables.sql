-- Physical mall products and orders (WeChat Pay / shipping).
CREATE TABLE IF NOT EXISTS mall_product (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
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
  payment_method VARCHAR(32) NOT NULL DEFAULT '',
  payment_mode VARCHAR(16) NOT NULL DEFAULT '',
  payment_trade_no VARCHAR(64) NOT NULL DEFAULT '',
  payment_transaction_id VARCHAR(64) NOT NULL DEFAULT '',
  payment_expires_at BIGINT NOT NULL DEFAULT 0,
  stock_reserved TINYINT(1) NOT NULL DEFAULT 0,
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
  KEY idx_mall_order_status (status, created_at DESC),
  KEY idx_mall_order_payment_trade (payment_trade_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
