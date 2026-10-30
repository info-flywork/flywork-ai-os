USE app_panel;

ALTER TABLE applications
  ADD COLUMN panel_api_key VARCHAR(255) DEFAULT NULL AFTER panel_slug;
