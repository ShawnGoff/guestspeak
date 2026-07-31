-- Featured/sponsored sessions flag
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_sessions_featured ON sessions (is_featured) WHERE is_featured = TRUE;
