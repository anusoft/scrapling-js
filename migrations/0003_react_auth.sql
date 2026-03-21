-- react-auth session tables
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Add columns to users for react-auth compatibility
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Copy existing picture → avatar_url
UPDATE users SET avatar_url = picture WHERE picture IS NOT NULL AND avatar_url IS NULL;

-- Migrate existing Google OAuth users to accounts table
INSERT OR IGNORE INTO accounts (id, user_id, provider_id, provider_user_id)
SELECT
  lower(hex(randomblob(16))),
  id,
  'google',
  google_id
FROM users WHERE google_id IS NOT NULL;

-- Set admin role for super admins
UPDATE users SET role = 'admin' WHERE email IN ('anu@1moby.com', 'waranon@1moby.com');
