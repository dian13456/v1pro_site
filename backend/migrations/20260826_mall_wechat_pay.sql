-- WeChat Pay metadata and inventory reservation for existing mall orders.
ALTER TABLE mall_order
  ADD COLUMN payment_method VARCHAR(32) NOT NULL DEFAULT '' AFTER total_cents,
  ADD COLUMN payment_mode VARCHAR(16) NOT NULL DEFAULT '' AFTER payment_method,
  ADD COLUMN payment_trade_no VARCHAR(64) NOT NULL DEFAULT '' AFTER payment_mode,
  ADD COLUMN payment_transaction_id VARCHAR(64) NOT NULL DEFAULT '' AFTER payment_trade_no,
  ADD COLUMN payment_expires_at BIGINT NOT NULL DEFAULT 0 AFTER payment_transaction_id,
  ADD COLUMN stock_reserved TINYINT(1) NOT NULL DEFAULT 0 AFTER payment_expires_at,
  ADD KEY idx_mall_order_payment_trade (payment_trade_no);
