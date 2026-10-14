-- ============================================================
--  Password reset tokens
--  Run once on databases created before this date.
--  (Fresh installs already get these columns from database-schema-mysql.sql)
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN reset_token_hash    CHAR(64) NULL,
  ADD COLUMN reset_token_expires DATETIME NULL,
  ADD INDEX idx_profiles_reset_token (reset_token_hash);
