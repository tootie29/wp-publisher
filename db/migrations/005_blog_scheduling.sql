-- Blog post spacing/scheduling.
--   projects.blog_interval_days     — minimum days between blog (post-route)
--                                     publishes for this project. 0 = disabled.
--   processed_rows.scheduled_for    — the future publish date we stamped on a
--                                     blog draft, so the next blog can space off
--                                     it even though it's still a draft (and thus
--                                     not visible in the WP publish/future query).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS blog_interval_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE processed_rows ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
