-- rollback/20261025_0043_department_guides.down.sql
--
-- Reversal for 20261025_0043_department_guides.sql (AFC-800).
--
-- What it destroys, stated plainly:
--   department_guides -- every guide row (instructional text per
--     department, ordered by sort_order). A rolled-back guide cannot be
--     re-derived: re-applying the forward file restores an empty table,
--     not the cleared text.
--   The department_guides_department_fkey FK, the
--   department_guides_title_check CHECK, and the
--   department_guides_department_sort_idx index. All live ON the dropped
--   table and die with it; dropped explicitly first so the script states
--   every removal. No CASCADE: a hidden dependency must fail loudly.
--
-- What it does NOT destroy: department rows (only referenced, never
-- owned), people_departments rows, or any grant on any other table. No
-- DROP TRIGGER / DROP FUNCTION / DROP RULE appears anywhere in this file
-- -- the forward file creates none, so the rollback-control gate has
-- nothing to reconcile. Where the table is absent (forward never applied)
-- every statement is conditional and the script is a no-op with a NOTICE.
--
-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a register that holds rows.
--
-- Guides are department facts with no legacy copy. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_guides integer := 0;
BEGIN
  IF to_regclass('public.department_guides') IS NULL THEN
    RAISE NOTICE 'department_guides is absent: nothing to roll back.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_guides FROM department_guides;

  IF v_guides > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back department guides: department_guides holds % row(s). These are department facts with no legacy copy; take a verified copy before proceeding. Empty rolls back; anything else does not.',
      v_guides
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'department guides rollback proceeding: no rows. Re-apply 20261025_0043 to get the table back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Grants off the app role first (reverse the ceiling), then the index,
--    then the constraints, then the table. Conditional throughout:
--    absence is not failure.
-- ---------------------------------------------------------------------------
REVOKE ALL ON department_guides FROM directus_app;

DROP INDEX IF EXISTS department_guides_department_sort_idx;

ALTER TABLE IF EXISTS department_guides DROP CONSTRAINT IF EXISTS department_guides_department_fkey;

ALTER TABLE IF EXISTS department_guides DROP CONSTRAINT IF EXISTS department_guides_title_check;

DROP TABLE IF EXISTS department_guides;
