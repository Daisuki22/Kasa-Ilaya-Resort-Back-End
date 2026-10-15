UPDATE `site_settings`
SET `logo_url` = '/img/kasa-ilaya-main-logo.webp',
    `updated_date` = CURRENT_TIMESTAMP
WHERE `id` = (
  SELECT `id`
  FROM (
    SELECT `id`
    FROM `site_settings`
    ORDER BY `updated_date` DESC
    LIMIT 1
  ) AS `latest_site_settings`
);
