-- 20261020_0018_welfare_events_append_only.sql
--
-- AFC-539 (parent AFC-510, ancestor AFC-472). Spec authority:
-- docs/planning/data-model.md §6.3 (welfare_case_events is the case audit
-- trail), AFC-510 decision: the trail is append-only.
--
-- WHAT THIS FILE DOES (one statement, nothing else):
--   REVOKE UPDATE ON welfare_case_events FROM directus_app.
-- Migration 20261020_0009_welfare_hardening.sql §4 granted
-- `UPDATE (detail, body)` on this table so note rows could be corrected
-- in place. AFC-510 revokes that: corrections append a new event row,
-- they never mutate a recorded one. The full-table REVOKE is a strict
-- tightening -- 0009 granted only (detail, body), so no column-level
-- UPDATE survives this file, and SELECT + INSERT are untouched.
--
-- CONDITIONAL (0002 §10 / 0005 / 0017 pattern): on Directus-first installs
-- where 0009 never ran, the table may be absent. Where it is absent this
-- file emits a NOTICE naming the owning migration and changes nothing --
-- it never forks the table. Rerunnable: REVOKE IF EXISTS has no such
-- form for privileges, so the DO block checks to_regclass first.
--
-- Rollback: rollback/20261020_0018_welfare_events_append_only.down.sql
-- (restores exactly what 0009 granted: UPDATE (detail, body)).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only the REVOKE below.
-- No durations, no awareness_at.

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
-- 1. The audit trail goes append-only, or a loud skip.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.welfare_case_events') IS NULL THEN
    RAISE NOTICE 'Skipping welfare_case_events append-only REVOKE: table not present. Migration 20261020_0009_welfare_hardening.sql (AFC-472) remains the owner of this table.';
  ELSE
    REVOKE UPDATE ON welfare_case_events FROM directus_app;
    RAISE NOTICE 'welfare_case_events is append-only for directus_app: UPDATE revoked (SELECT + INSERT retained). Corrections append a new event row (AFC-510).';
  END IF;
END
$$;
