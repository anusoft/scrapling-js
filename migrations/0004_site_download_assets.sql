-- Add download_assets flag to sites table (opt-in PDF/image download during crawl)
ALTER TABLE sites ADD COLUMN download_assets INTEGER DEFAULT 0;
