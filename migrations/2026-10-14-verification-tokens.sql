-- ============================================================
--  Verification links: one row per email sent, so every link
--  emailed stays valid (not only the most recent one).
--  Run once on databases created before this date.
--  (Fresh installs already get this from database-schema-mysql.sql)
-- ============================================================

-- Part 1: new table + copy any links that are still valid
CREATE TABLE email_verification_tokens (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_verification_token (token_hash),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
SELECT id, verify_token_hash, verify_token_expires
FROM profiles
WHERE verify_token_hash IS NOT NULL AND verify_token_expires > NOW();

-- Part 2: remove the old single-link columns
-- (on a live site, run this only after the new code is deployed)
ALTER TABLE profiles
  DROP INDEX idx_profiles_verify_token,
  DROP COLUMN verify_token_hash,
  DROP COLUMN verify_token_expires;
