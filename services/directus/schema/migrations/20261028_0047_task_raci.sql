-- Migration 0047: task RACI refs (AFC-833, chairman direction 2026-10-27).
--
-- Adds four nullable person refs to the tasks register so every task can
-- name its RACI ring: responsible (does), accountable (owns the outcome),
-- consulted (two-way input), informed (one-way update). Nullable: existing
-- rows stay valid and unassigned tasks keep working.
--
-- FKs are CONDITIONAL (0013 §4 pattern): the people register is
-- Directus-owned and may be absent (scratch databases, Directus never
-- booted). The link is SET NULL so a person purge never destroys the
-- task. Grants extend the 0013 ceiling: directus_app gets UPDATE on the
-- four columns (assignment is a correction, same as assignee_person);
-- no new INSERT columns (creation stamps assignees, RACI is set on
-- review); NO DELETE anywhere (unchanged). REVOKE PUBLIC on the new
-- columns' scope is covered by the table-level PUBLIC revoke below (kept
-- explicit, same as 0013 style).
--
-- Review: R1 self-claim by the operator run (AFC-833). R2 CTO review on
-- the AFC-833 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0047_task_raci.down.sql (refuses while any
-- task names a RACI member; drops the FKs, then the columns). Owner:
-- migration role (directus_migrator). Never run as directus_app. Role
-- hygiene per ADR-0002: this file provisions no roles.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). tasks must already belong
--    to directus_migrator: only an owner may ALTER it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('tasks')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the task RACI columns: % is not owned by '
      'directus_migrator, and only an owner may ALTER it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. RACI columns. Nullable person refs; assignment happens on review.
-- ---------------------------------------------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raci_responsible uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raci_accountable uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raci_consulted uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raci_informed uuid;

COMMENT ON COLUMN tasks.raci_responsible IS 'AFC-833: RACI does-the-work person ref (nullable).';
COMMENT ON COLUMN tasks.raci_accountable IS 'AFC-833: RACI owns-the-outcome person ref (nullable).';
COMMENT ON COLUMN tasks.raci_consulted IS 'AFC-833: RACI two-way-input person ref (nullable).';
COMMENT ON COLUMN tasks.raci_informed IS 'AFC-833: RACI one-way-update person ref (nullable).';

-- ---------------------------------------------------------------------------
-- 3. Conditional FKs to people (0013 §4 pattern). SET NULL so a person
--    purge never destroys the task; absent people register means bare
--    uuids until Directus boots.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  col text;
  cname text;
BEGIN
  FOREACH col IN ARRAY ARRAY['raci_responsible', 'raci_accountable', 'raci_consulted', 'raci_informed'] LOOP
    cname := 'tasks_' || col || '_fkey';
    IF to_regclass('public.people') IS NULL THEN
      RAISE NOTICE 'Skipping %: people not present. The ref stays a bare uuid until Directus boots.', cname;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
      EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES people(id) ON DELETE SET NULL', cname, col);
      RAISE NOTICE 'FK added: tasks.%I -> people(id) SET NULL.', col;
    ELSE
      RAISE NOTICE '% already present, left alone.', cname;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling: extend the 0013 UPDATE list with the four
--    RACI columns (assignment is a correction). No new INSERT columns,
--    NO DELETE (unchanged).
-- ---------------------------------------------------------------------------
GRANT UPDATE (raci_responsible, raci_accountable, raci_consulted, raci_informed)
  ON tasks TO directus_app;

REVOKE ALL ON tasks FROM PUBLIC;
