USE app_panel;

CREATE TABLE IF NOT EXISTS login_verification_challenges (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_challenge_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_login_challenge_user (user_id),
  INDEX idx_login_challenge_expires (expires_at)
);
