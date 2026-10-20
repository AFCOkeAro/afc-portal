-- 20261020_0019_finance_actor_stamps.sql
--
-- First-class actor trail on weca_returns (AFC-544, slice of AFC-515).
-- Spec authority: parent AFC-515 BUILD decision (board answer 2026-10-20).
--
-- WHAT THIS FILE DOES (two columns, nothing else):
--   weca_returns.submitted_by uuid -- who moved calculated -> submitted.
--   weca_returns.confirmed_by uuid -- who moved submitted -> confirmed.
-- Bare uuids (Directus users are owned elsewhere), nullable (a calculated
-- return has no actor yet). Mirrors the branch_financial_records pattern
-- (0001 §1: submitted_by / confirmed_by beside the lifecycle status).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No finance_events timeline table: inventing it here forks the audit
--   contract (the portal route stamps the actor columns; the Directus
--   activity log holds the same transition as backstop, exactly like the
--   branch-records route documents). Deferred to its own audit-shape slice.
--   No backfill of historic actors: a guessed actor is a fabricated trail.
--   Existing rows keep NULLs; new transitions stamp the server session user.
--   No currency change, no computed-line change.
--
-- GRANTS (expansion §10 posture: Postgres sees one app identity; branch/zone
-- scoping lives in the Directus policy + portal route filters, not here):
--   directus_app gets UPDATE on the two actor columns only, the same ceiling
--   branch_financial_records already states. Computed lines stay read-only
--   to the app (the 0001 grant withholds them; this file does not widen it).
--
-- Rollback: rollback/20261020_0019_finance_actor_stamps.down.sql (refuses
-- while any return carries a non-null actor; drops the columns, revokes the
-- grants). Owner: migration role (directus_migrator).
-- Never run as directus_app. Role hygiene per ADR-0002: this file provisions
-- no roles and grants no role-creation or superuser capability; only
-- GRANT/REVOKE below. No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Actor columns on weca_returns. Rerunnable: IF NOT EXISTS.
-- ---------------------------------------------------------------------------
ALTER TABLE weca_returns ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE weca_returns ADD COLUMN IF NOT EXISTS confirmed_by uuid;

COMMENT ON COLUMN weca_returns.submitted_by IS
  'Who moved this return calculated -> submitted (portal server-session user id at submit time). NULL until submitted. Mirrors branch_financial_records.submitted_by.';
COMMENT ON COLUMN weca_returns.confirmed_by IS
  'Who moved this return submitted -> confirmed (portal server-session user id at confirm time). NULL until confirmed. Mirrors branch_financial_records.confirmed_by.';

-- ---------------------------------------------------------------------------
-- 2. Least privilege: the app may stamp the two actor columns on the
--    lifecycle transition and read them back. Nothing else changes: the 0001
--    ceiling (computed lines never hand-edited, formulas read-only) stands.
-- ---------------------------------------------------------------------------
GRANT UPDATE (submitted_by, confirmed_by) ON weca_returns TO directus_app;

REVOKE ALL ON weca_returns FROM PUBLIC;
