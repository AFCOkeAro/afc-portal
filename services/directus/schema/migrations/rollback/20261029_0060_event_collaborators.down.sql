-- rollback/20261029_0060_event_collaborators.down.sql
--
-- Reversal for 20261029_0060_event_collaborators.sql (AFC-880).
--
-- What it destroys, stated plainly:
--   event_collaborators -- every per-event delegation. Refuses while rows
--   exist: a rolled-back register silently strips collaborators of access
--   they were granted, so a non-empty table does not roll back.
--
-- What it does NOT destroy: events/people/branches/zones rows (only
-- referenced), roles, policies, permissions, or any grant on any other
-- table. Where the table is absent (forward never applied) the script is a
-- no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_collaborators') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM event_collaborators;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event collaborators: the table holds % row(s). Remove the delegations first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'collaborators rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS event_collaborators;
