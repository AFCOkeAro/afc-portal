-- rollback/20261028_0056_event_feedback.down.sql
--
-- Reversal for 20261028_0056_event_feedback.sql (AFC-828 phase 2).
--
-- What it destroys, stated plainly:
--   event_feedback -- every fan submission. Refuses while rows exist: a
--   rolled-back register silently drops what the public said, so a
--   non-empty table does not roll back.
--
-- What it does NOT destroy: events/branches/zones rows (only referenced),
-- roles, policies, permissions, or any grant on any other table. Where the
-- table is absent (forward never applied) the script is a no-op with a
-- NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_feedback') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM event_feedback;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event feedback: the table holds % row(s). Clear the submissions first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'feedback rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS event_feedback;
