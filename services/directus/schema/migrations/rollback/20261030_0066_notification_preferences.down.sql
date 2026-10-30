-- rollback/20261030_0066_notification_preferences.down.sql
--
-- Reversal for 20261030_0066_notification_preferences.sql (AFC-903 phase 1).
--
-- What it destroys, stated plainly:
--   notification_preferences -- every admin's channel switches, cadence and
--   sections. Refuses while rows exist: a rolled-back register silently
--   drops opt-ins and opt-outs the admin chose, so a non-empty table does
--   not roll back.
--
-- What it does NOT destroy: users rows (only referenced as bare uuids),
-- roles, policies, permissions, or any grant on any other table. Where the
-- table is absent (forward never applied) the script is a no-op with a
-- NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.notification_preferences') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM notification_preferences;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back notification preferences: the table holds % row(s). Remove the preference rows first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'notification preferences rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS notification_preferences;
