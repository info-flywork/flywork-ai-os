-- Mevcut veritabanina uygulama API URL kolonlarini ekler (bir kez calistirin).
USE app_panel;

ALTER TABLE applications
  ADD COLUMN analyse_api_url VARCHAR(600) DEFAULT NULL AFTER icon_url,
  ADD COLUMN health_api_url VARCHAR(600) DEFAULT NULL AFTER analyse_api_url;
