-- rollback/20261020_0026_household_roles.down.sql
--
-- Reversal for 20261020_0026_household_roles.sql (AFC-590).
--
-- What it destroys, stated plainly:
--   people.household_role -- every member's wizard-assigned family role
--     (head_of_household / spouse / child / relative). A rolled-back role
--     cannot be re-derived (households.household_head still names the
--     head, but spouse/child/relative distinctions are lost).
--   The people_household_role_check constraint and the partial index.
--     Both live ON the dropped column and die with it; dropped explicitly
--     first so the script states every removal. No CASCADE: a hidden
--     dependency must fail loudly.
--
-- What it does NOT destroy: people rows (only the column); households
-- rows (only referenced); household_head links; or any grant on any
-- other column. No DROP TRIGGER / DROP FUNCTION / DROP RULE appears
-- anywhere in this file -- the forward file creates none, so the
-- rollback-control gate has nothing to reconcile. Where people is absent
-- (forward never applied) every statement is conditional and the script
-- is a no-op with a NOTICE.
--
-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a register whose roles are in use.
--
-- Member roles are family facts (including minors). Empty (all-NULL)
-- rolls back; anything else needs a verified copy first and a reviewed
-- step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_roles integer := 0;
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'people is absent: nothing to roll back.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'people'
                AND column_name = 'household_role') THEN
    SELECT count(*) INTO v_roles FROM people WHERE household_role IS NOT NULL;
  END IF;

  IF v_roles > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back household roles: % people row(s) carry a non-null household_role. These are family facts (including minors); take a verified copy before proceeding. All-NULL rolls back; anything else does not.',
      v_roles
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'household roles rollback proceeding: no roles assigned. Re-apply 20261020_0026 to get the column back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The CHECK, then the column (the index lives on the column and dies
--    with it; dropped explicitly so the script states every removal).
--    Conditional throughout: absence is not failure.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS people_household_role_idx;

ALTER TABLE IF EXISTS people DROP CONSTRAINT IF EXISTS people_household_role_check;

ALTER TABLE IF EXISTS people DROP COLUMN IF EXISTS household_role;
