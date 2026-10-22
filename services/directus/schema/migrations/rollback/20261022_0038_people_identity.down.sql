-- rollback/20261022_0038_people_identity.down.sql
--
-- Reversal for 20261022_0038_people_identity.sql (AFC-700).
--
-- What it destroys, stated plainly:
--   people.first_name, people.last_name, people.branch -- the values AND
--     every link they carry. A rolled-back name cannot be re-derived and a
--     rolled-back branch link cannot be re-derived: re-applying the forward
--     file restores empty columns, not the cleared identity.
--   The people_branch_idx index and the three column grants the forward
--     file created. The grants are revoked explicitly; the FK dies with its
--     column. No separate constraint drop.
--
-- What it does NOT destroy: people rows (only the three identity columns
-- go), branches rows (only referenced, never owned), or any grant on any
-- other table. No CASCADE: a hidden dependency must fail loudly, not vanish
-- silently. No DROP TRIGGER / DROP FUNCTION / DROP RULE appears anywhere in
-- this file -- the forward file creates none, so the rollback-control gate
-- has nothing to reconcile. Where the columns are absent (forward never
-- applied) every statement is IF EXISTS and the script is a no-op.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back identity that holds data.
--
-- Names and branch links are personal data (this surface holds children's
-- data). Empty columns roll back; anything else needs a verified copy first
-- and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_named integer := 0;
  v_linked integer := 0;
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'people not present; nothing to roll back.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'people'
                AND column_name IN ('first_name', 'last_name')) THEN
    SELECT count(*) INTO v_named FROM people
     WHERE first_name IS NOT NULL OR last_name IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'people'
                AND column_name = 'branch') THEN
    SELECT count(*) INTO v_linked FROM people WHERE branch IS NOT NULL;
  END IF;

  IF v_named > 0 OR v_linked > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back people identity: % people row(s) carry a name and % carry a branch link. Names and branch links are personal data; take a verified copy before proceeding. Empty columns roll back; anything else does not.',
      v_named, v_linked
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'people identity rollback proceeding: no names, no branch links. Re-apply 20261022_0038 to get the columns back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The column grants the forward file added, then the index, then the
--    columns. Dependency order, IF EXISTS throughout: absence is not failure.
-- ---------------------------------------------------------------------------
REVOKE INSERT (first_name, last_name, branch) ON people FROM directus_app;
REVOKE UPDATE (first_name, last_name, branch) ON people FROM directus_app;

DROP INDEX IF EXISTS people_branch_idx;

ALTER TABLE people DROP COLUMN IF EXISTS branch;
ALTER TABLE people DROP COLUMN IF EXISTS last_name;
ALTER TABLE people DROP COLUMN IF EXISTS first_name;
