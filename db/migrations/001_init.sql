-- 001_init.sql
-- Projects table — replaces config/projects/*.json files.
-- The WP application password is stored encrypted (AES-256-GCM, key from APP_SECRET).

CREATE TABLE IF NOT EXISTS projects (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
  owner_email                TEXT,

  wp_base_url                TEXT NOT NULL,
  wp_username                TEXT NOT NULL,
  wp_app_password_encrypted  TEXT NOT NULL,

  sheet_id                   TEXT NOT NULL,
  sheet_tab_name             TEXT NOT NULL,
  sheet_columns              JSONB NOT NULL,
  sheet_header_row           INTEGER NOT NULL DEFAULT 1,
  sheet_trigger_value        TEXT NOT NULL DEFAULT 'In-Progress',
  sheet_completed_value      TEXT NOT NULL DEFAULT 'Content Live',

  page_type_routing          JSONB NOT NULL DEFAULT '{}'::jsonb,
  publish_status             TEXT NOT NULL DEFAULT 'draft',

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_owner_email_idx ON projects(LOWER(owner_email));
