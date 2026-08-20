-- Store lottery shipment tracking numbers so winners can query them.
ALTER TABLE winner
  ADD COLUMN tracking_no VARCHAR(128) NOT NULL DEFAULT '' AFTER shipping_status;
