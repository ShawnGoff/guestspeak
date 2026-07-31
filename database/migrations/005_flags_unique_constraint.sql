-- Prevent users from flagging the same question more than once.
-- Registered users are deduplicated by (question_id, user_id);
-- guests by (question_id, guest_token).

ALTER TABLE flags
  ADD CONSTRAINT flags_unique_user
    UNIQUE (question_id, user_id);

ALTER TABLE flags
  ADD CONSTRAINT flags_unique_guest
    UNIQUE (question_id, guest_token);
