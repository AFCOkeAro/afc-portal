-- rollback/20261020_0033_minutes_attendee_policy_mirror.down.sql
--
-- Reversal for 20261020_0033_minutes_attendee_policy_mirror.sql (AFC-704 F1).
--
-- What it destroys, stated plainly:
--   minutes_attendees.minute_status + minutes_attendees.minute_created_by
--   (both created by 0033), the minutes_attendees_minute_attach_idx index
--   (created by 0033), the afc_set_minute_attach_scope trigger and the
--   afc_set_minute_attach_scope() function (both created by 0033).
-- The trigger exists only to maintain the two columns, and the columns are
-- derived (recomputable by re-applying 0033), so the down script need not
-- refuse on populated tables -- re-apply restores every value from the
-- parent minutes. No CASCADE: a hidden dependency must fail loudly.
-- Parent tables, 0013 columns, 0030 branch/zone denorm and every
-- directus_permissions row are never touched: this migration created none
-- of them.
--
-- Only run after the Directus create-permissions generated from these
-- columns (MINUTES_ATTENDEE_CREATE_FILTER) have been replaced -- otherwise
-- the flat filter references columns that no longer exist (same caveat as
-- the 0030 rollback).
--
-- Rollback-control reconciliation (scripts/migration-rollback-gate.mjs):
-- the trigger and its function are dropped together with the only columns
-- they exist to maintain, both created by the forward file and both dropped
-- here -- F1 reversals of their own referents, the same shape as the 0030
-- and 0032 down scripts this file mirrors.

DROP TRIGGER IF EXISTS afc_set_minute_attach_scope ON minutes_attendees;

DROP FUNCTION IF EXISTS afc_set_minute_attach_scope();

DROP INDEX IF EXISTS minutes_attendees_minute_attach_idx;

ALTER TABLE minutes_attendees
  DROP COLUMN IF EXISTS minute_status,
  DROP COLUMN IF EXISTS minute_created_by;

DO $$
BEGIN
  RAISE NOTICE '0033 rolled back: minute_status/minute_created_by + trigger + function + index removed. Re-apply 20261020_0033 to restore (values recompute from office_minutes).';
END
$$;
