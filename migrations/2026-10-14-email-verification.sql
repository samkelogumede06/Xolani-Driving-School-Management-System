-- ============================================================
--  Email verification for self-registered accounts
--  Run once on databases created before this date.
--  Existing accounts are marked as verified so they keep working.
--  (Fresh installs already get these columns from database-schema-mysql.sql)
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN email_verified       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN verify_token_hash    CHAR(64) NULL,
  ADD COLUMN verify_token_expires DATETIME NULL,
  ADD INDEX idx_profiles_verify_token (verify_token_hash);
