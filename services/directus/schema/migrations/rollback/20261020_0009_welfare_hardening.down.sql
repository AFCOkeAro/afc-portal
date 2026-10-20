-- rollback/20261020_0009_welfare_hardening.down.sql
--
-- Reversal for 20261020_0009_welfare_hardening.sql. AFC-472.
--
-- What it destroys, stated plainly:
--   welfare_case_events -- the audit trail INCLUDING freeform note bodies
--     (re-applying the forward file recreates the empty tables; audit rows
--     written after the migration are destroyed with the table).
--   welfare_contributions -- contributions recorded after the migration.
--   welfare_cases -- cases recorded after the migration, INCLUDING any
--     confidentiality values and restricted description/outcome_notes.
--
-- What it does NOT destroy: people and branches (owned elsewhere; this
-- migration only REFERENCES them) and no trigger/function (the forward file
-- creates none, so the rollback-control gate has only drops of objects this
-- same migration created to reconcile -- F1: each referent goes in this
-- same script). No CASCADE: a hidden dependency must fail loudly, not vanish
-- silently.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back welfare that holds rows.
--
-- Case rows are ministry facts over children's personal data. Empty tables
-- roll back; anything else needs a verified copy first and a reviewed step,
-- not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cases integer; v_contribs integer; v_events integer;
BEGIN
  SELECT count(*) INTO v_cases FROM welfare_cases;
  SELECT count(*) INTO v_contribs FROM welfare_contributions;
  SELECT count(*) INTO v_events FROM welfare_case_events;

  IF v_cases > 0 OR v_contribs > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back welfare hardening: welfare_cases holds % row(s), welfare_contributions holds % row(s) and welfare_case_events holds % row(s). These are case records over personal data including minors. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_cases, v_contribs, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'welfare rollback proceeding: no cases, contributions or events. Re-apply 20261020_0009 to get the empty tables back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables in dependency order: events + contributions (children) before
--    cases (referenced by both). No CASCADE.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS welfare_case_events;
DROP TABLE IF EXISTS welfare_contributions;
DROP TABLE IF EXISTS welfare_cases;
