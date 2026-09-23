CREATE TABLE IF NOT EXISTS pending_registrations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  created_date DATETIME NOT NULL,
  updated_date DATETIME NOT NULL,
  email VARCHAR(191) NOT NULL,
  full_name VARCHAR(191) NOT NULL,
  birth_date DATE NULL,
  phone VARCHAR(64) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'guest',
  app_id VARCHAR(191) NOT NULL DEFAULT 'local-kasa-ilaya',
  app_role VARCHAR(64) NOT NULL DEFAULT 'guest',
  UNIQUE KEY pending_registrations_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS registration_otps (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NULL,
  pending_registration_id VARCHAR(64) NULL,
  otp_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'registration',
  attempts INT NOT NULL DEFAULT 0,
  created_date DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  verified_at DATETIME NULL,
  KEY idx_registration_otps_user (user_id),
  KEY idx_registration_otps_pending (pending_registration_id),
  KEY idx_registration_otps_created (created_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  otp_hash VARCHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_date DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  verified_at DATETIME NULL,
  KEY idx_password_reset_otps_user (user_id),
  KEY idx_password_reset_otps_created (created_date),
  CONSTRAINT fk_password_reset_otp_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'reset_authorization',
  attempts INT NOT NULL DEFAULT 0,
  created_date DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY idx_password_reset_tokens_user (user_id),
  KEY idx_password_reset_tokens_hash (token_hash),
  CONSTRAINT fk_password_reset_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE registration_otps
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'registration' AFTER otp_hash,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0 AFTER purpose,
  ADD COLUMN IF NOT EXISTS verified_at DATETIME NULL AFTER used_at;

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'reset_authorization' AFTER token_hash,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0 AFTER purpose;
