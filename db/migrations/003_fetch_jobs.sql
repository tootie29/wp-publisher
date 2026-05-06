-- Postgres-backed fetch job queue. Replaces the in-memory globalThis queue
-- so the extension's poll endpoint and the worker's enqueue/wait can run in
-- separate serverless invocations (Vercel) and still see each other.

CREATE TABLE IF NOT EXISTS fetch_jobs (
  id           UUID PRIMARY KEY,
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,                    -- 'surfer' | 'frase'
  owner_key    TEXT NOT NULL,                    -- userKey of the requester
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | taken | completed | failed
  result_html  TEXT,
  result_title TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  taken_at     TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- The poll endpoint claims the oldest pending job for a user; this index
-- makes that lookup O(log N) instead of a full scan.
CREATE INDEX IF NOT EXISTS fetch_jobs_owner_pending_idx
  ON fetch_jobs (owner_key, created_at)
  WHERE status = 'pending';
