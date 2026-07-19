CREATE TABLE schema_migrations (
  identifier text PRIMARY KEY,
  file_name text NOT NULL UNIQUE,
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
