-- rollback/20261028_0047_task_raci.down.sql
--
-- Reversal for 20261028_0047_task_raci.sql (AFC-833).
--
-- What it destroys, stated plainly:
--   tasks.raci_responsible / raci_accountable / raci_consulted /
--   raci_informed -- the RACI ring. Refuses while any task names a
--   member (that is an explicit assignment, not a default to drop).
--
-- What it does NOT destroy: task rows, any other column, or any grant on
-- any other column. Where the columns are absent (forward never applied)
-- the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_named integer := 0;
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tasks'
                    AND column_name = 'raci_responsible') THEN
    SELECT count(*) INTO v_named FROM tasks
     WHERE raci_responsible IS NOT NULL
        OR raci_accountable IS NOT NULL
        OR raci_consulted IS NOT NULL
        OR raci_informed IS NOT NULL;
  END IF;

  IF v_named > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back the task RACI columns: % task(s) name a RACI member. Clear them first; assignments are explicit.',
      v_named
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'task RACI rollback proceeding: no named members.';
END $$;

ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_raci_responsible_fkey;
ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_raci_accountable_fkey;
ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_raci_consulted_fkey;
ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_raci_informed_fkey;
ALTER TABLE IF EXISTS tasks
  DROP COLUMN IF EXISTS raci_responsible,
  DROP COLUMN IF EXISTS raci_accountable,
  DROP COLUMN IF EXISTS raci_consulted,
  DROP COLUMN IF EXISTS raci_informed;
