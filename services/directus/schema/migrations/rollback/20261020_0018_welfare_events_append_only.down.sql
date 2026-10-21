-- rollback/20261020_0018_welfare_events_append_only.down.sql
--
-- Reversal for 20261020_0018_welfare_events_append_only.sql. AFC-539
-- (parent AFC-510, ancestor AFC-472).
--
-- What it restores, stated plainly:
--   UPDATE (detail, body) ON welfare_case_events TO directus_app --
--     byte for byte what migration 20261020_0009_welfare_hardening.sql §4
--     granted (AFC-472). Re-applying the forward file revokes it again.
--
-- What it does NOT touch: the table, its rows, its columns, its index,
-- or any other grant. SELECT + INSERT on this table and every grant on
-- welfare_cases / welfare_contributions are owned by 0009 and left alone.
-- No CASCADE: a hidden dependency must fail loudly, not vanish silently.
-- No DROP TRIGGER / DROP FUNCTION / DROP RULE / DROP CONSTRAINT appears
-- anywhere in this file -- the forward file creates none, so the
-- rollback-control gate has nothing to reconcile.
-- No GRANT beyond the single restoration above; no role statements
-- (ADR-0002). A GRANT restore is not a control drop, so F1/F2 have
-- nothing to reconcile either.
--
-- Absence is not failure: where the host table is missing (the forward
-- migration skipped loudly too) the script is a no-op with a NOTICE.

DO $$
BEGIN
  IF to_regclass('public.welfare_case_events') IS NULL THEN
    RAISE NOTICE 'welfare_case_events absent: nothing this migration revoked can be restored. Rollback is a no-op.';
    RETURN;
  END IF;

  GRANT UPDATE (detail, body) ON welfare_case_events TO directus_app;

  RAISE NOTICE
    'welfare_case_events UPDATE (detail, body) restored to directus_app (0009 state). Re-apply 20261020_0018 to go append-only again.';
END
$$;
