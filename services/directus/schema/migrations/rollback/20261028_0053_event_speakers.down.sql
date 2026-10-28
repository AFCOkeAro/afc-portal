-- rollback/20261028_0053_event_speakers.down.sql
--
-- Reversal for 20261028_0053_event_speakers.sql (AFC-843).
--
-- What it destroys, stated plainly:
--   event_speakers -- every speaker booking. Refuses while rows exist: a
--   rolled-back register silently drops the booked/pending picture, so a
--   non-empty table does not roll back.
--
-- What it does NOT destroy: events/branches/zones/people rows (only
-- referenced), roles, policies, permissions, or any grant on any other
-- table. Where the table is absent (forward never applied) the script is a
-- no-op with a NOTICE.
--
-- NOTE: the AFC-844 resources register holds a speaker FK. If that slice
-- has landed, its link must be parked (or its rows cleared) before this
-- down script can drop the referent — the DROP fails loudly otherwise.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_speakers') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM event_speakers;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event speakers: the table holds % row(s). Clear the bookings first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'speakers rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS event_speakers;
