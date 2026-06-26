-- Extends the fetch_jobs queue so the extension can also fetch raw image bytes
-- from the user's authenticated session (fallback for session-gated images that
-- the server can't download directly).
--
-- kind = 'content' (default, existing behavior — returns scraped article HTML)
--      | 'image'   (returns base64 image bytes in result_html, MIME in
--                   result_content_type)

ALTER TABLE fetch_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'content';
ALTER TABLE fetch_jobs ADD COLUMN IF NOT EXISTS result_content_type TEXT;
