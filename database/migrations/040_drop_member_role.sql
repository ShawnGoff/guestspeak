-- Migration 040: remove the 'member' channel role
--
-- It granted nothing. 'member' appeared in exactly one place in the backend —
-- the schema that accepted it — and was never checked anywhere else. A member
-- could not create sessions for the channel, could not moderate, and
-- listMyOrgs filters them out, so the channel did not even appear in their own
-- list. The settings page offered it as a choice and the host had no way to
-- tell it did nothing.
--
-- Existing rows are deleted rather than promoted. Promoting to admin would hand
-- out rights the host never chose to grant; deleting matches the capability
-- they already had, which was none.
DELETE FROM organization_members WHERE role = 'member';

ALTER TABLE organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner', 'admin'));

-- The old default was 'member', which no longer exists. There is no sensible
-- default for a role that grants real power, so the column loses it and the
-- caller has to say.
ALTER TABLE organization_members
  ALTER COLUMN role DROP DEFAULT;
