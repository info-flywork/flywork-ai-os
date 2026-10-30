USE app_panel;

ALTER TABLE applications
  ADD COLUMN users_api_url VARCHAR(600) DEFAULT NULL AFTER health_api_url;
