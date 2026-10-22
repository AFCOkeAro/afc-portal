-- rollback/20261020_0034_blessings_count_recipients.down.sql
--
-- Reversal for 20261020_0034_blessings_count_recipients.sql (AFC-671).
--
-- What it destroys, stated plainly:
--   blessing_recipients          -- individual blessing rows.
--   blessings.count              -- the single-count column (only when it
--                                  carries no diverged data: every row must
--                                  satisfy count = male+female, which holds
--                                  for the backfill and for mirrored writes).
--   The conditional FKs die with the table; parent tables (branches/zones/
--   people/events/sunday_services/...) are never touched. No CASCADE.
--   The 0011 blessings table, its GENERATED total, and its audit trail are
--   never touched: this rollback owns only what 0034 created.

-- ---------------------------------------------------------------------------
-- 0. Refuse while individual blessings exist, or while `count` diverges.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_recipients integer; v_diverged integer;
BEGIN
  SELECT count(*) INTO v_recipients FROM blessing_recipients;
  SELECT count(*) INTO v_diverged FROM blessings WHERE count <> male_count + female_count;

  IF v_recipients > 0 OR v_diverged > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back blessings count/recipients: blessing_recipients holds % row(s) and % blessing row(s) carry diverged counts. These are captured ministry facts. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_recipients, v_diverged
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'blessings 0034 rollback proceeding: no recipients and no diverged counts. Re-apply 20261020_0034 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Recipients first (child of blessings), then the count column.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS blessing_recipients;

ALTER TABLE blessings DROP COLUMN IF EXISTS count;
