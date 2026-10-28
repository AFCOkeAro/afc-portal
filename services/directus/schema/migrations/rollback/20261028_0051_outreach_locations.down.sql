-- rollback/20261028_0051_outreach_locations.down.sql
--
-- Reversal for 20261028_0051_outreach_locations.sql (AFC-841).
--
-- What it destroys, stated plainly:
--   outreach_location_secretaries -- every secretary assignment.
--   outreach_locations -- every mission field row.
-- Refuses while either table holds rows: a rolled-back AVS register
-- silently drops the mission-field list, so non-empty tables do not roll
-- back.
--
-- What it does NOT destroy: branches/zones/people rows (only referenced),
-- roles, policies, permissions, or any grant on any other table. Where the
-- tables are absent (forward never applied) every statement is IF EXISTS
-- and the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_locations integer := 0;
  v_links integer := 0;
BEGIN
  IF to_regclass('public.outreach_locations') IS NOT NULL THEN
    SELECT count(*) INTO v_locations FROM outreach_locations;
  END IF;
  IF to_regclass('public.outreach_location_secretaries') IS NOT NULL THEN
    SELECT count(*) INTO v_links FROM outreach_location_secretaries;
  END IF;

  IF v_locations > 0 OR v_links > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back outreach locations: outreach_locations holds % row(s), assignments hold % row(s). Clear the AVS lists first; empty tables roll back, anything else does not.',
      v_locations, v_links
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'outreach rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS outreach_location_secretaries;
DROP TABLE IF EXISTS outreach_locations;
