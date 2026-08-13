CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_meta(key, value)
VALUES ('foundation_version', '1')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
