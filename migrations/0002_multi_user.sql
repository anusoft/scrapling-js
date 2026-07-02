-- Add user_id to jobs table
ALTER TABLE jobs ADD COLUMN user_id TEXT;

-- Create sites table (replaces file-based sites.json)
CREATE TABLE IF NOT EXISTS sites (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    key             TEXT NOT NULL,
    label           TEXT NOT NULL,
    sitemap         TEXT NOT NULL DEFAULT '',
    allowed_domains TEXT NOT NULL DEFAULT '[]',
    browser         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    UNIQUE(user_id, key)
);

-- Indexes for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
