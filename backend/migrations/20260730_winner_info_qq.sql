-- Add QQ field for winner shipping contact (encrypted).
ALTER TABLE winner_info
  ADD COLUMN qq_enc TEXT NOT NULL AFTER wechat_enc;
