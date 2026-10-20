-- rollback/20261020_0023_attendance_sessions.down.sql
--
-- Reversal for 20261020_0023_attendance_sessions.sql (AFC-566).
--
-- What it destroys, stated plainly:
--   attendance_sessions, attendance_records -- every row in both (session
--     headers + name-level check-ins, including minors; a rolled-back row
--     cannot be re-derived, and capture idempotency keys are ground truth).
--   The three merge FKs §3 added (attendance_counts_session_fkey,
--   blessings_session_fkey, events_attendance_session_fkey). F4 for all
--   three: dropping them is forced -- their definitions reference the
--   sessions table this script drops, so refusing would leave the script
--   unrunnable. No CASCADE: the failure of a hidden dependency must be
--   loud.
--
-- What it does NOT destroy: branches/zones/BSCs/services/service-type
-- definitions/people rows (only referenced), or any grant on any other
-- table. No DROP TRIGGER / DROP FUNCTION / DROP RULE appears anywhere in
-- this file -- the forward file creates none, so the rollback-control gate
-- has nothing to reconcile. Where the tables are absent (forward never
-- applied) every statement is IF EXISTS and the script is a no-op with a
-- NOTICE.
--
-- Down-order caveat: reverse order is 0024 -> 0023 -> 0021. A later slice
-- may own FKs that reference attendance_sessions; if any is still present,
-- the DROP TABLE below fails loudly instead of cascading, by design.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back registers that hold rows.
--
-- Sessions and check-ins are audited ministry facts. Empty tables roll
-- back; anything else needs a verified copy first and a reviewed step, not
-- this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sessions integer := 0;
  v_records integer := 0;
BEGIN
  IF to_regclass('public.attendance_sessions') IS NOT NULL THEN
    SELECT count(*) INTO v_sessions FROM attendance_sessions;
  END IF;

  IF to_regclass('public.attendance_records') IS NOT NULL THEN
    SELECT count(*) INTO v_records FROM attendance_records;
  END IF;

  IF v_sessions > 0 OR v_records > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back attendance sessions/records: attendance_sessions holds % row(s), attendance_records holds % row(s). These are audited facts (including minors); take a verified copy before proceeding. Empty tables roll back; anything else does not.',
      v_sessions, v_records
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'attendance rollback proceeding: no rows. Re-apply 20261020_0023 to get the tables back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The three merge FKs §3 added, then the records register, then the
--    sessions register. Dependency order, no CASCADE. IF EXISTS
--    throughout: absence is not failure.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS attendance_counts DROP CONSTRAINT IF EXISTS attendance_counts_session_fkey;

ALTER TABLE IF EXISTS blessings DROP CONSTRAINT IF EXISTS blessings_session_fkey;

ALTER TABLE IF EXISTS events DROP CONSTRAINT IF EXISTS events_attendance_session_fkey;

DROP TABLE IF EXISTS attendance_records;

DROP TABLE IF EXISTS attendance_sessions;
