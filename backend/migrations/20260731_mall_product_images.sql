-- Add multiple product images for mall catalog.
ALTER TABLE mall_product
  ADD COLUMN image_urls MEDIUMTEXT NULL AFTER image_url;

UPDATE mall_product
SET image_urls = JSON_ARRAY(image_url)
WHERE image_url <> '' AND (image_urls IS NULL OR image_urls = '');

UPDATE mall_product
SET image_urls = '[]'
WHERE image_urls IS NULL OR image_urls = '';
