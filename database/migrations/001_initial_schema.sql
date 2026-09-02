-- Ask Away — Initial Schema
-- Run order matters: referenced tables must exist before foreign keys

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "earthdistance" CASCADE; -- for nearby queries (depends on cube)

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE,
  username        VARCHAR(50)  UNIQUE,
  password_hash   VARCHAR(255),
  is_guest        BOOLEAN      NOT NULL DEFAULT false,
  -- Saved join code prefix, e.g. "PBOX" → sessions become "PBOX7X4"
  -- UNIQUE so no two accounts can claim the same prefix (NULL values don't conflict)
  code_prefix     VARCHAR(20) UNIQUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email    ON users (email);
CREATE INDEX idx_users_username ON users (username);

-- ============================================================
-- ORGANIZATIONS
-- A shared account for podcasts, shows, brands, etc.
-- One org can own many sessions and maintain a standing mod team.
-- ============================================================
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  -- URL slug: askaway.com/org/how-did-this-get-made
  slug          VARCHAR(100) UNIQUE NOT NULL,
  description   TEXT,
  avatar_url    VARCHAR(500),
  website       VARCHAR(500),
  -- Saved join code prefix for all sessions under this org (unique, claimed first-come)
  code_prefix   VARCHAR(20) UNIQUE,
  -- Verified orgs get a badge — set manually by admins for legitimate stations/shows
  is_verified   BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations (slug);

-- ============================================================
-- ORGANIZATION MEMBERS
-- owner  — full control, can delete org, transfer ownership
-- admin  — can create sessions, manage members and moderators
-- member — listed as part of the org; no elevated session perms
-- ============================================================
CREATE TABLE organization_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- owner | admin | member
  role        VARCHAR(20) NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_members_org  ON organization_members (org_id);
CREATE INDEX idx_org_members_user ON organization_members (user_id);

-- ============================================================
-- SESSIONS
-- org_id is optional — sessions can belong to an org or an individual.
-- Location fields are optional — used for Nearby discovery.
-- ============================================================
CREATE TABLE sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id          UUID         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- NULL = individual session; set = belongs to an org
  org_id           UUID         REFERENCES organizations (id) ON DELETE SET NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  -- public | unlisted | private
  -- public   → appears in Live Now + Nearby discovery
  -- unlisted → link-only, invisible in discovery (fan club / private show)
  -- private  → invite-only (future)
  visibility       VARCHAR(20)  NOT NULL DEFAULT 'public'
                   CHECK (visibility IN ('public', 'unlisted', 'private')),
  -- upcoming | live | closed
  status           VARCHAR(20)  NOT NULL DEFAULT 'upcoming'
                   CHECK (status IN ('upcoming', 'live', 'closed')),
  -- URL-safe slug, e.g. "tech-ama-001-abc123"
  slug             VARCHAR(100) UNIQUE NOT NULL,
  -- Short speakable join code, e.g. "PBOX7X4" — read on air, typed on phone
  join_code        VARCHAR(20)  UNIQUE NOT NULL,
  -- 1–5 credits per user; >5 requires a paid purchase (future monetization)
  credits_per_user INTEGER      NOT NULL DEFAULT 3
                   CHECK (credits_per_user BETWEEN 1 AND 5),
  -- Optional: close question submission before the event starts
  submission_cutoff_at TIMESTAMPTZ,
  -- Location — all optional; used for Nearby tab in discovery
  city             VARCHAR(100),
  region           VARCHAR(100), -- state / province
  country          VARCHAR(100),
  lat              NUMERIC(9, 6),
  lng              NUMERIC(9, 6),
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_host_id    ON sessions (host_id);
CREATE INDEX idx_sessions_org_id     ON sessions (org_id);
CREATE INDEX idx_sessions_slug       ON sessions (slug);
CREATE INDEX idx_sessions_join_code  ON sessions (join_code);
CREATE INDEX idx_sessions_status     ON sessions (status);
CREATE INDEX idx_sessions_visibility ON sessions (visibility, status);
-- Geo index for nearby queries
CREATE INDEX idx_sessions_location   ON sessions (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ============================================================
-- SESSION PARTICIPANTS
-- (one row per user/guest per session — tracks credits & actions)
-- ============================================================
CREATE TABLE session_participants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  -- NULL for guests
  user_id           UUID        REFERENCES users (id) ON DELETE SET NULL,
  -- token assigned to guests
  guest_token       VARCHAR(255),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credits_remaining INTEGER     NOT NULL DEFAULT 3,
  actions_used      INTEGER     NOT NULL DEFAULT 0,

  -- a participant is either a registered user or a guest, not both
  CONSTRAINT chk_participant_identity CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL)
    OR
    (user_id IS NULL AND guest_token IS NOT NULL)
  ),
  UNIQUE (session_id, user_id),
  UNIQUE (session_id, guest_token)
);

CREATE INDEX idx_session_participants_session ON session_participants (session_id);
CREATE INDEX idx_session_participants_user    ON session_participants (user_id);

-- ============================================================
-- QUESTIONS
-- ============================================================
CREATE TABLE questions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  -- NULL if author deleted account
  author_id          UUID        REFERENCES users (id) ON DELETE SET NULL,
  author_guest_token VARCHAR(255),
  body               TEXT        NOT NULL,
  -- new | starred | answered | hidden
  status             VARCHAR(20) NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'starred', 'answered', 'hidden')),
  -- denormalized for fast sorting; kept in sync by trigger
  vote_count         INTEGER     NOT NULL DEFAULT 0,
  -- Host can reply to unanswered questions after the session closes
  host_reply         TEXT,
  host_replied_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_session_id  ON questions (session_id);
CREATE INDEX idx_questions_status      ON questions (session_id, status);
CREATE INDEX idx_questions_vote_count  ON questions (session_id, vote_count DESC);
CREATE INDEX idx_questions_created_at  ON questions (session_id, created_at DESC);

-- ============================================================
-- VOTES  (Echoes, internally)
-- ============================================================
CREATE TABLE votes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  -- NULL for guests
  user_id     UUID        REFERENCES users (id) ON DELETE SET NULL,
  guest_token VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_vote_identity CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL)
    OR
    (user_id IS NULL AND guest_token IS NOT NULL)
  ),
  UNIQUE (question_id, user_id),
  UNIQUE (question_id, guest_token)
);

CREATE INDEX idx_votes_question_id ON votes (question_id);

-- ============================================================
-- FLAGS
-- ============================================================
CREATE TABLE flags (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id           UUID        REFERENCES users (id) ON DELETE SET NULL,
  guest_token       VARCHAR(255),
  -- spam | offensive | harassment | off_topic | other
  reason            VARCHAR(50) NOT NULL
                    CHECK (reason IN ('spam', 'offensive', 'harassment', 'off_topic', 'other')),
  is_moderator_flag BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flags_question_id ON flags (question_id);

-- ============================================================
-- SESSION MODERATORS
-- Per-session explicit moderators (individuals, not org-based).
-- Org owners/admins inherit moderation rights automatically in app logic.
-- ============================================================
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

-- ============================================================
-- ORG FOLLOWERS
-- Users follow an org to get notified when new sessions are created.
-- ============================================================
CREATE TABLE org_followers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_followers_org  ON org_followers (org_id);
CREATE INDEX idx_org_followers_user ON org_followers (user_id);

-- ============================================================
-- NOTIFICATIONS
-- In-app notifications. Payload is JSON so we can attach any
-- context (session_id, org_id, question_id, etc.) without
-- separate columns per notification type.
-- ============================================================
CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- e.g. "session:live", "session:upcoming", "question:replied"
  type       VARCHAR(50) NOT NULL,
  payload    JSONB       NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,                          -- NULL = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user    ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread  ON notifications (user_id) WHERE read_at IS NULL;

-- ============================================================
-- TRIGGER: keep questions.vote_count in sync with votes table
-- ============================================================
CREATE OR REPLACE FUNCTION update_vote_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE questions SET vote_count = vote_count + 1, updated_at = NOW()
    WHERE id = NEW.question_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE questions SET vote_count = GREATEST(vote_count - 1, 0), updated_at = NOW()
    WHERE id = OLD.question_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_vote_count
AFTER INSERT OR DELETE ON votes
FOR EACH ROW EXECUTE FUNCTION update_vote_count();

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sessions_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_questions_updated_at
BEFORE UPDATE ON questions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
