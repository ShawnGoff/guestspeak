-- Ask Away — Development Seed Data
-- Run after 001_initial_schema.sql

-- Host user (password: "password123" — bcrypt hash placeholder)
INSERT INTO users (id, email, username, password_hash, is_guest)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'host@example.com',
  'hostuser',
  '$2b$10$placeholder_hash_here',
  false
);

-- Registered attendee
INSERT INTO users (id, email, username, password_hash, is_guest)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'attendee@example.com',
  'attendee1',
  '$2b$10$placeholder_hash_here',
  false
);

-- A test session
INSERT INTO sessions (id, host_id, title, description, visibility, status, slug, credits_per_user)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Ask Me Anything — Tech Edition',
  'Open Q&A about software, startups, and building in public.',
  'public',
  'live',
  'tech-ama-001',
  3
);

-- Some questions
INSERT INTO questions (session_id, author_id, body, status, vote_count)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002',
   'What inspired you to start building in public?', 'new', 0),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002',
   'How do you stay motivated when a project stalls?', 'new', 0);
