-- rollback/20261020_0020_households_departments.down.sql
--
-- Reversal for 20261020_0020_households_departments.sql (AFC-566).
--
-- What it destroys, stated plainly:
--   households, departments, people_departments -- every row in all three
--     (family units, board-shaped departments, membership history).
--   people.household -- the column AND every link it carries. A rolled-back
--     link cannot be re-derived: re-applying the forward file restores an
--     empty column, not the cleared assignments.
--   The seven indexes, six CHECKs, UNIQUE pair, and four FKs the forward
--     file created. FKs die with their tables/columns; no separate drop.
--
-- What it does NOT destroy: people rows (only the household link goes),
-- branches/zones rows (only referenced, never owned), or any grant on any
-- other table. The GRANT UPDATE (household) ON people is revoked explicitly.
-- No CASCADE: a hidden dependency must fail loudly, not vanish silently.
-- No DROP TRIGGER / DROP FUNCTION / DROP RULE appears anywhere in this file
-- -- the forward file creates none, so the rollback-control gate has nothing
-- to reconcile. Where the tables are absent (forward never applied) every
-- statement is IF EXISTS and the script is a no-op with a NOTICE.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a register that holds rows or live links.
--
-- Households are family data and the junction is assignment history on a
-- surface that holds children's data. Empty tables roll back; anything else
-- needs a verified copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_households integer := 0;
  v_links integer := 0;
  v_linked_people integer := 0;
BEGIN
  IF to_regclass('public.households') IS NOT NULL THEN
    SELECT count(*) INTO v_households FROM households;
  END IF;

  IF to_regclass('public.people_departments') IS NOT NULL THEN
    SELECT count(*) INTO v_links FROM people_departments;
  END IF;

  IF to_regclass('public.people') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'people'
                    AND column_name = 'household') THEN
    SELECT count(*) INTO v_linked_people FROM people WHERE household IS NOT NULL;
  END IF;

  IF v_households > 0 OR v_links > 0 OR v_linked_people > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back households/departments: households holds % row(s), people_departments holds % row(s), % people row(s) carry a household link. These are family data and assignment history; take a verified copy before proceeding. Empty tables and unlinked people roll back; anything else does not.',
      v_households, v_links, v_linked_people
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'households/departments rollback proceeding: no rows, no live links. Re-apply 20261020_0020 to get the tables back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The junction first (it constrains both sides), then the link column's
--    FK, then the column, then the two registers. Dependency order, no
--    CASCADE. IF EXISTS throughout: absence is not failure.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS people_departments;

ALTER TABLE IF EXISTS people DROP CONSTRAINT IF EXISTS people_household_fkey;

REVOKE UPDATE (household) ON people FROM directus_app;

ALTER TABLE IF EXISTS people DROP COLUMN IF EXISTS household;

DROP TABLE IF EXISTS departments;

DROP TABLE IF EXISTS households;
