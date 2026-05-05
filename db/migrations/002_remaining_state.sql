-- 002_remaining_state.sql
-- Replaces the rest of the on-disk state stores:
--   data/<id>.processed.json       → processed_rows
--   logs/<id>.jsonl                → logs
--   data/connector/<u>/<id>/*.enc.json → connector_cookies
--   config/service-account.json    → service_account

CREATE TABLE IF NOT EXISTS processed_rows (
  project_id      TEXT        NOT NULL,
  row_index       INTEGER     NOT NULL,
  wp_id           INTEGER     NOT NULL,
  wp_link         TEXT        NOT NULL,
  edit_link       TEXT        NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_link     TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  page_type       TEXT        NOT NULL,
  route           TEXT        NOT NULL CHECK (route IN ('post', 'page')),
  primary_keyword TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('success', 'partial')),
  PRIMARY KEY (project_id, row_index)
);
CREATE INDEX IF NOT EXISTS processed_rows_project_processed_at_idx
  ON processed_rows(project_id, processed_at DESC);

CREATE TABLE IF NOT EXISTS logs (
  id          BIGSERIAL   PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_id  TEXT        NOT NULL,
  row_index   INTEGER,
  level       TEXT        NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
  message     TEXT        NOT NULL,
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS logs_project_ts_idx ON logs(project_id, ts DESC);
CREATE INDEX IF NOT EXISTS logs_ts_idx ON logs(ts DESC);

-- Per-user connector session cookies/storage. The encrypted_blob holds the
-- AES-GCM ciphertext (iv.tag.ciphertext) of the JSON ConnectorRecord.
CREATE TABLE IF NOT EXISTS connector_cookies (
  user_key       TEXT        NOT NULL,
  project_id     TEXT        NOT NULL,
  source         TEXT        NOT NULL CHECK (source IN ('surfer', 'frase')),
  encrypted_blob TEXT        NOT NULL,
  saved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_key, project_id, source)
);

-- Single-row table holding the GCP service account JSON, encrypted at rest.
CREATE TABLE IF NOT EXISTS service_account (
  id              TEXT        PRIMARY KEY DEFAULT 'default',
  client_email    TEXT        NOT NULL,
  encrypted_blob  TEXT        NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
