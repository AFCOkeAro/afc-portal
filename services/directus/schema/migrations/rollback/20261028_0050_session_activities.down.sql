-- rollback/20261028_0050_session_activities.down.sql
--
-- Reversal for 20261028_0050_session_activities.sql (AFC-826).
--
-- What it destroys, stated plainly:
--   session_activities -- every programme item. Refuses while rows exist:
--   a rolled-back builder silently drops the order of service, so an empty
--   table is the precondition.
--
-- What it does NOT destroy: attendance_sessions rows (the parent), roles,
-- policies, permissions, or any grant on any other table. Where the table
-- is absent (forward never applied) the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.session_activities') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM session_activities;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back session_activities: the table holds % row(s). Clear the programme items first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'session_activities rollback proceeding: no items.';
END $$;

DROP TABLE IF EXISTS session_activities;
