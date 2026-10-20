-- rollback/20261020_0003_attendance_counts.down.sql
--
-- Reversal for 20261020_0003_attendance_counts.sql. AFC-468 / AFC-461c.
--
-- What it destroys, stated plainly:
--   attendance_counts -- the split rows, INCLUDING any backfilled from legacy
--     headcount columns (re-applying the forward file re-runs the backfill, so
--     a rollback followed by a re-apply restores the mapped rows; split rows
--     captured after the migration are destroyed with the table).
--   service_type_definitions -- the eleven seed rows and any board-added rows.
--   The conditional denorm column (§2: attendance_sessions.service_type_def)
--   is dropped only where the host table exists; its absence is not a
--   failure, because the forward migration may have skipped it too (same
--   posture as 0002's down script §1).
--
-- What it does NOT destroy: attendance_sessions itself (owned elsewhere; this
-- migration never created it) and the 0002 denorm columns (zone, bsc). No
-- CASCADE: a hidden dependency must fail loudly, not vanish silently. No
-- trigger/function is created by the forward file, so the rollback-control
-- gate has only drops of objects this same migration created to reconcile
-- (F1: each referent goes in this same script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back attendance that holds rows.
--
-- Attendance rows are captured ministry facts. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script. The seed counts as rows: an operator rolls back a seeded database
-- by deleting the eleven definition rows as the migrator first, which is a
-- deliberate act, not an accident.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_defs integer; v_counts integer;
BEGIN
  SELECT count(*) INTO v_defs FROM service_type_definitions;
  SELECT count(*) INTO v_counts FROM attendance_counts;

  IF v_defs > 0 OR v_counts > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back attendance split: service_type_definitions holds % row(s) and attendance_counts holds % row(s). These are captured ministry facts including the eleven seed definitions. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_defs, v_counts
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'attendance rollback proceeding: no definitions or counts. Re-apply 20261020_0003 to get the seed back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The denorm column added by forward §2, then tables in dependency order:
--    counts (child) before definitions (referenced by sessions, which survives).
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS service_type_def;

DROP TABLE IF EXISTS attendance_counts;
DROP TABLE IF EXISTS service_type_definitions;
