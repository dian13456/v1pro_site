-- Add multiple product images for mall catalog.
ALTER TABLE mall_product
  ADD COLUMN image_urls MEDIUMTEXT NOT NULL DEFAULT '[]' AFTER image_url;
