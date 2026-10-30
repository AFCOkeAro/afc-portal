-- rollback/20261030_0063_visitor_intake_extras.down.sql
--
-- Reversal for 20261030_0063_visitor_intake_extras.sql (AFC-907).
--
-- What it destroys, stated plainly:
--   visitors.address, visitors.campaign, visitors.source,
--   visitors.is_cross_branch_visit -- every entered address, campaign
--   attribution, source and cross-branch flag. A rolled-back intake cannot
--   be re-derived: re-applying the forward file restores empty columns,
--   not the cleared values.
--
-- What it does NOT destroy: visitor rows (only referenced, never owned),
-- people rows, campaign rows, or any grant on any other column. No DROP
-- TRIGGER / DROP FUNCTION / DROP RULE appears anywhere in this file --
-- the forward file creates none, so the rollback-control gate has nothing
-- to reconcile. Where the columns are absent (forward never applied),
-- this file is a silent no-op.
--
-- Reversal for 0063: drop the four intake columns.
ALTER TABLE visitors
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS campaign,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS is_cross_branch_visit;

-- Verify the reversal, then stop.
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE EXCEPTION
      'refusing 0063 rollback: visitors is absent -- nothing to reverse.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'visitors'
       AND column_name IN ('address', 'campaign', 'source', 'is_cross_branch_visit')
  ) THEN
    RAISE EXCEPTION
      'refusing 0063 rollback: an intake column is still present -- the drop did not take.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;
