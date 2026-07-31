-- Add display name for guest participants
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS guest_username TEXT;
