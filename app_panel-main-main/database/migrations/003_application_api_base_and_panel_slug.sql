USE app_panel;

ALTER TABLE applications
  ADD COLUMN api_base_url VARCHAR(600) DEFAULT NULL AFTER icon_url,
  ADD COLUMN panel_slug VARCHAR(64) DEFAULT NULL AFTER api_base_url;
