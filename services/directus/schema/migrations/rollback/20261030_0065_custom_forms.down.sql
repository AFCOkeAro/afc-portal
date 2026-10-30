-- rollback/20261030_0065_custom_forms.down.sql
--
-- Reversal for 20261030_0065_custom_forms.sql (AFC-897).
--
-- What it destroys, stated plainly:
--   custom_forms -- every staff-built form definition. Refuses while rows
--   exist: a rolled-back register silently deletes forms the modules still
--   render, so a non-empty table does not roll back.
--
-- What it does NOT destroy: the linked module rows ever submitted through
-- those forms (they live in their own registers), roles, policies,
-- permissions, or any grant on any other table. Where the table is absent
-- (forward never applied) the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.custom_forms') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM custom_forms;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back custom forms: the table holds % row(s). Remove the definitions first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'custom forms rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS custom_forms;
