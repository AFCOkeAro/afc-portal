-- rollback/20261020_0010_sunday_services.down.sql
--
-- Reversal for 20261020_0010_sunday_services.sql. AFC-473 / AFC-463b.
--
-- What it destroys, stated plainly:
--   sunday_services      -- service headers (branch/zone/date/type/theme).
--   service_assignments  -- the roster rows.
--   sunday_service_events -- the service audit trail.
--   The conditional denorm columns on attendance_sessions (zone, bsc,
--   service_type_def) are dropped only where the host table exists; their
--   absence is not a failure, because the forward migration may have skipped
--   them too (same posture as 0002/0003 down scripts). The
--   attendance_counts_session_fkey is dropped where both tables exist.
--   headcount_* columns are never touched (back-compat).
--
-- What it does NOT destroy: attendance_sessions itself (owned elsewhere; this
-- migration never created it), attendance_counts, service_type_definitions,
-- branches/zones/people (referenced parents, never owned here). No CASCADE:
-- a hidden dependency must fail loudly, not vanish silently. No trigger or
-- function is created by the forward file, so the rollback-control gate has
-- only drops of objects this same migration created to reconcile
-- (F1: each referent goes in this same script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back services that hold rows.
--
-- Service rows are captured ministry facts. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script. The audit trail counts as rows: rolling back over events would
-- destroy the record of what happened, which is exactly what the trail is
-- for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_services integer; v_assignments integer; v_events integer;
BEGIN
  SELECT count(*) INTO v_services FROM sunday_services;
  SELECT count(*) INTO v_assignments FROM service_assignments;
  SELECT count(*) INTO v_events FROM sunday_service_events;

  IF v_services > 0 OR v_assignments > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back sunday services: sunday_services holds % row(s), service_assignments holds % row(s) and sunday_service_events holds % row(s). These are captured ministry facts including their audit trail. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_services, v_assignments, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'services rollback proceeding: no services, assignments or events. Re-apply 20261020_0010 to restore the tables.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The merge-contract FK added by forward §3, then the denorm columns added
--    by forward §2 (only where the host table exists), then tables in
--    dependency order: events + assignments (children) before services.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_session_fkey') THEN
    ALTER TABLE attendance_counts DROP CONSTRAINT attendance_counts_session_fkey;
    RAISE NOTICE 'attendance_counts_session_fkey dropped (merge contract 0003).';
  ELSE
    RAISE NOTICE 'attendance_counts_session_fkey absent, nothing to drop.';
  END IF;
END
$$;

ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS service_type_def;
ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS bsc;
ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS zone;

DROP TABLE IF EXISTS sunday_service_events;
DROP TABLE IF EXISTS service_assignments;
DROP TABLE IF EXISTS sunday_services;
