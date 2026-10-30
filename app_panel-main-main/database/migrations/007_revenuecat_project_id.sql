ALTER TABLE applications
  ADD COLUMN revenuecat_project_id VARCHAR(64) DEFAULT NULL AFTER panel_api_key;
