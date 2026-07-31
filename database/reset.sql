-- GuestSpeak — Full database reset
-- Drops everything and rebuilds from all migrations in order.
-- Run with: psql askaway -f database/reset.sql

-- ============================================================
-- WIPE
-- ============================================================
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

-- ============================================================
-- 001 — Initial schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "earthdistance" CASCADE;

-- USERS
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE,
  username        VARCHAR(50)  UNIQUE,
  password_hash   VARCHAR(255),
  is_guest        BOOLEAN      NOT NULL DEFAULT false,
  code_prefix     VARCHAR(20) UNIQUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_email    ON users (email);
CREATE INDEX idx_users_username ON users (username);

-- ORGANIZATIONS
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(100) UNIQUE NOT NULL,
  description   TEXT,
  avatar_url    VARCHAR(500),
  website       VARCHAR(500),
  code_prefix   VARCHAR(20) UNIQUE,
  is_verified   BOOLEAN      NOT NULL DEFAULT false,
  -- Location (007)
  city          TEXT,
  region        TEXT,
  country       TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  -- Categories (009)
  categories    TEXT[]       NOT NULL DEFAULT '{}',
  -- Online only (010)
  is_online     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_organizations_slug ON organizations (slug);

-- ORGANIZATION MEMBERS
CREATE TABLE organization_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_members_org  ON organization_members (org_id);
CREATE INDEX idx_org_members_user ON organization_members (user_id);

-- SESSIONS
CREATE TABLE sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id              UUID         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  org_id               UUID         REFERENCES organizations (id) ON DELETE SET NULL,
  title                VARCHAR(255) NOT NULL,
  description          TEXT,
  visibility           VARCHAR(20)  NOT NULL DEFAULT 'public'
                       CHECK (visibility IN ('public', 'unlisted', 'private')),
  status               VARCHAR(20)  NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming', 'live', 'closed')),
  slug                 VARCHAR(100) UNIQUE NOT NULL,
  join_code            VARCHAR(20)  UNIQUE NOT NULL,
  credits_per_user     INTEGER      NOT NULL DEFAULT 3
                       CHECK (credits_per_user BETWEEN 1 AND 5),
  submission_cutoff_at TIMESTAMPTZ,
  city                 VARCHAR(100),
  region               VARCHAR(100),
  country              VARCHAR(100),
  lat                  NUMERIC(9, 6),
  lng                  NUMERIC(9, 6),
  is_featured          BOOLEAN      NOT NULL DEFAULT FALSE,  -- 003
  is_online            BOOLEAN      NOT NULL DEFAULT FALSE,  -- 008
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_host_id    ON sessions (host_id);
CREATE INDEX idx_sessions_org_id     ON sessions (org_id);
CREATE INDEX idx_sessions_slug       ON sessions (slug);
CREATE INDEX idx_sessions_join_code  ON sessions (join_code);
CREATE INDEX idx_sessions_status     ON sessions (status);
CREATE INDEX idx_sessions_visibility ON sessions (visibility, status);
CREATE INDEX idx_sessions_location   ON sessions (lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX idx_sessions_featured   ON sessions (is_featured) WHERE is_featured = TRUE;

-- SESSION PARTICIPANTS
CREATE TABLE session_participants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id           UUID        REFERENCES users (id) ON DELETE SET NULL,
  guest_token       VARCHAR(255),
  guest_username    TEXT,        -- 006
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credits_remaining INTEGER     NOT NULL DEFAULT 3,
  actions_used      INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT chk_participant_identity CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL)
    OR (user_id IS NULL AND guest_token IS NOT NULL)
  ),
  UNIQUE (session_id, user_id),
  UNIQUE (session_id, guest_token)
);
CREATE INDEX idx_session_participants_session ON session_participants (session_id);
CREATE INDEX idx_session_participants_user    ON session_participants (user_id);

-- QUESTIONS
CREATE TABLE questions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  author_id          UUID        REFERENCES users (id) ON DELETE SET NULL,
  author_guest_token VARCHAR(255),
  body               TEXT        NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'starred', 'answered', 'hidden')),
  is_pinned          BOOLEAN     NOT NULL DEFAULT FALSE,   -- 011
  is_spotlighted     BOOLEAN     NOT NULL DEFAULT FALSE,   -- 012
  vote_count         INTEGER     NOT NULL DEFAULT 0,
  host_reply         TEXT,
  host_replied_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_questions_session_id  ON questions (session_id);
CREATE INDEX idx_questions_status      ON questions (session_id, status);
CREATE INDEX idx_questions_vote_count  ON questions (session_id, vote_count DESC);
CREATE INDEX idx_questions_created_at  ON questions (session_id, created_at DESC);
CREATE INDEX idx_questions_spotlighted ON questions (session_id) WHERE is_spotlighted = TRUE;

-- VOTES
CREATE TABLE votes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES users (id) ON DELETE SET NULL,
  guest_token VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_vote_identity CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL)
    OR (user_id IS NULL AND guest_token IS NOT NULL)
  ),
  UNIQUE (question_id, user_id),
  UNIQUE (question_id, guest_token)
);
CREATE INDEX idx_votes_question_id ON votes (question_id);

-- FLAGS
CREATE TABLE flags (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id           UUID        REFERENCES users (id) ON DELETE SET NULL,
  guest_token       VARCHAR(255),
  reason            VARCHAR(50) NOT NULL
                    CHECK (reason IN ('spam', 'offensive', 'harassment', 'off_topic', 'other')),
  is_moderator_flag BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT flags_unique_user  UNIQUE (question_id, user_id),   -- 005
  CONSTRAINT flags_unique_guest UNIQUE (question_id, guest_token) -- 005
);
CREATE INDEX idx_flags_question_id ON flags (question_id);

-- SESSION MODERATORS
CREATE TABLE session_moderators (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  can_mark_answered BOOLEAN     NOT NULL DEFAULT false,
  can_star          BOOLEAN     NOT NULL DEFAULT false,
  can_flag          BOOLEAN     NOT NULL DEFAULT false,
  can_hide          BOOLEAN     NOT NULL DEFAULT false,
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_session_moderators_session ON session_moderators (session_id);
CREATE INDEX idx_session_moderators_user    ON session_moderators (user_id);

-- ORG FOLLOWERS
CREATE TABLE org_followers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_followers_org  ON org_followers (org_id);
CREATE INDEX idx_org_followers_user ON org_followers (user_id);

-- NOTIFICATIONS
CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  payload    JSONB       NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user   ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ============================================================
-- 002 — Password reset tokens
-- ============================================================
CREATE TABLE password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prt_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX idx_prt_user_id    ON password_reset_tokens (user_id);

-- ============================================================
-- 004 — User follows
-- ============================================================
CREATE TABLE user_follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);
CREATE INDEX idx_user_follows_follower  ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_vote_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE questions SET vote_count = vote_count + 1, updated_at = NOW() WHERE id = NEW.question_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE questions SET vote_count = GREATEST(vote_count - 1, 0), updated_at = NOW() WHERE id = OLD.question_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_vote_count
AFTER INSERT OR DELETE ON votes
FOR EACH ROW EXECUTE FUNCTION update_vote_count();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sessions_updated_at      BEFORE UPDATE ON sessions      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_questions_updated_at     BEFORE UPDATE ON questions     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_users_updated_at         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
