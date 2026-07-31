-- 009: Add categories array to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';
