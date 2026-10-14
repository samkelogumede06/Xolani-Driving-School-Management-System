-- ============================================================
--  Instructor portal: force a password change on first login
--  Run once on databases created before this date.
--  (Fresh installs already get this column from database-schema-mysql.sql)
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
