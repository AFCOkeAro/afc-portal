-- rollback/20261022_0037_impersonation_events.down.sql
--
-- Reversal for 20261022_0037 (AFC-684 impersonation audit).
--
-- What it destroys, stated plainly:
--   impersonation_events -- the start/stop audit rows.
--   No parent table is touched (targets are bare uuids, no FK): branches,
--   zones, directus_users and every other table are never touched.
--   No CASCADE needed: the table has no children.

-- ---------------------------------------------------------------------------
-- 0. Refuse while audit rows exist. These are auth-critical audit facts;
--    take a verified copy before proceeding. An empty table rolls back,
--    a populated one does not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM impersonation_events;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back impersonation_events: impersonation_events holds % row(s). These are auth-critical audit facts. Take a verified copy before proceeding; an empty table rolls back, a populated one does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'impersonation_events 0037 rollback proceeding: no audit rows. Re-apply 20261022_0037 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The audit table only.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS impersonation_events;
