-- rollback/20261020_0021_events_registrations.down.sql
--
-- Reversal for 20261020_0021_events_registrations.sql (AFC-566).
--
-- What it destroys, stated plainly:
--   events, event_registrations -- every row in both (event catalogue +
--     registrant PII, including minors; a rolled-back row cannot be
--     re-derived, and ticket/group codes are Flow-assigned ground truth).
--   Nothing on event_invites: 0021 adds no FK there (choice 6 -- the 0005
--   merge stays open), so there is nothing of this file's to remove from
--   that table.
--   The two merge FKs §3 added (event_referrals_event_fkey CASCADE,
--   blessings_event_fkey SET NULL). F4 for both: dropping them is forced --
--   their definitions reference the events table this script drops, so
--   refusing would leave the script unrunnable. No CASCADE: the failure of
--   a hidden dependency must be loud.
--
-- Down-order caveat: 0023 (attendance) may own events_attendance_session_fkey
-- on the events table by the time this runs. Reverse 0023 first -- its down
-- script drops the FK it added. If that FK is still present, the DROP TABLE
-- below fails loudly instead of cascading, by design.
--   The §1-§2 indexes, CHECKs, UNIQUEs this file created. FKs die with their
--   tables; no separate drop.
--
-- What it does NOT destroy: people/branches rows (only referenced), or any
-- grant on any other table. No CASCADE: a hidden dependency must fail
-- loudly, not vanish silently. No DROP TRIGGER / DROP FUNCTION / DROP RULE
-- appears anywhere in this file -- the forward file creates none, so the
-- rollback-control gate has nothing to reconcile. Where the tables are
-- absent (forward never applied) every statement is IF EXISTS and the
-- script is a no-op with a NOTICE.
--
-- Absence caveat: event_invites holds bare event uuids (choice 6), so no
-- FK of this file's blocks the drop; the row-guard below is the only gate.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back registers that hold rows.
--
-- Events are the board-published catalogue and registrations are personal
-- data. Empty tables roll back; anything else needs a verified copy first
-- and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_events integer := 0;
  v_regs integer := 0;
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    SELECT count(*) INTO v_events FROM events;
  END IF;

  IF to_regclass('public.event_registrations') IS NOT NULL THEN
    SELECT count(*) INTO v_regs FROM event_registrations;
  END IF;

  IF v_events > 0 OR v_regs > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back events/registrations: events holds % row(s), event_registrations holds % row(s). These are the published catalogue + registrant PII (including minors); take a verified copy before proceeding. Empty tables roll back; anything else does not.',
      v_events, v_regs
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'events/registrations rollback proceeding: no rows. Re-apply 20261020_0021 to get the tables back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The two merge FKs §3 added, then the registration register, then the
--    event register. Dependency order, no CASCADE. IF EXISTS throughout:
--    absence is not failure.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS event_referrals DROP CONSTRAINT IF EXISTS event_referrals_event_fkey;

ALTER TABLE IF EXISTS blessings DROP CONSTRAINT IF EXISTS blessings_event_fkey;

DROP TABLE IF EXISTS event_registrations;

DROP TABLE IF EXISTS events;
