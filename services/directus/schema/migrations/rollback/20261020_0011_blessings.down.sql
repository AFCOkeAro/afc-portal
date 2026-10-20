-- rollback/20261020_0011_blessings.down.sql
--
-- Reversal for 20261020_0011_blessings.sql. AFC-474 / AFC-463c.
--
-- What it destroys, stated plainly:
--   blessings        -- the per-(program, blessing_type) count rows.
--   blessing_events  -- the blessing audit trail.
--   The conditional FKs (§2: blessings_branch_fkey, blessings_zone_fkey,
--   blessings_bsc_fkey, blessings_session_fkey, blessings_event_fkey,
--   blessings_sunday_service_fkey) die with the table; they constrain no
--   surviving object, so there is nothing to drop separately. Parent tables
--   (branches/zones/events/sunday_services/...) are never touched: this
--   migration never created them. No CASCADE: a hidden dependency must fail
--   loudly, not vanish silently. No trigger or function is created by the
--   forward file, so the rollback-control gate has only drops of objects this
--   same migration created to reconcile (F1: each referent goes in this same
--   script). The CHECK constraints and the GENERATED total die with their
--   table (no ALTER ... DROP CONSTRAINT statement, so no control is removed
--   from a surviving object).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back blessings that hold rows.
--
-- Blessing rows are captured ministry facts. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script. The audit trail counts as rows: rolling back over events would
-- destroy the record of what happened, which is exactly what the trail is
-- for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_blessings integer; v_events integer;
BEGIN
  SELECT count(*) INTO v_blessings FROM blessings;
  SELECT count(*) INTO v_events FROM blessing_events;

  IF v_blessings > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back blessings: blessings holds % row(s) and blessing_events holds % row(s). These are captured ministry facts including their audit trail. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_blessings, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'blessings rollback proceeding: no blessings or events. Re-apply 20261020_0011 to restore the tables.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables in dependency order: events (child) before blessings.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS blessing_events;
DROP TABLE IF EXISTS blessings;
