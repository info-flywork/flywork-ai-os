-- Mevcut kurulum: mysql -u USER -p DB_NAME < database/migrations/006_utf8mb4_charset.sql

ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE applications CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE login_verification_challenges CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
