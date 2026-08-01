-- Migration 018: credit regen — track when the last regen credit was awarded
-- last_credit_at is set on join and updated each time a heartbeat awards a credit.
-- NULL means no credit has been awarded yet (eligible immediately after 10 min).

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS last_credit_at TIMESTAMPTZ DEFAULT NULL;
