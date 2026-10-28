-- rollback/20261028_0054_event_resources.down.sql
--
-- Reversal for 20261028_0054_event_resources.sql (AFC-844).
--
-- What it destroys, stated plainly:
--   event_resources -- every resource row. Refuses while rows exist: a
--   rolled-back register silently drops the approved library, so a
--   non-empty table does not roll back. The conditional speaker FK dies
--   with the table; no parking needed.
--
-- What it does NOT destroy: events/branches/zones/speakers rows (only
-- referenced), uploaded files in directus_files (storage outlives the
-- catalogue row that pointed at it), roles, policies, permissions, or any
-- grant on any other table. Where the table is absent (forward never
-- applied) the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_resources') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM event_resources;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event resources: the table holds % row(s). Clear the library first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'resources rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS event_resources;
