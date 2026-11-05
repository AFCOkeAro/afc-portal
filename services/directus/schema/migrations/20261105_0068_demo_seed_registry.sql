-- 20261105_0068_demo_seed_registry.sql
--
-- Demo seed registry + demo admin audit (AFC-1086, parent AFC-1084).
--
-- WHAT THIS FILE CREATES (verified: no CREATE TABLE for either exists in
-- services/directus/schema/migrations/ -- grep demo_seed_registry /
-- demo_admin_actions hits nothing before this file):
--   demo_seed_registry   -- one row per demo row the seed plants:
--                           (table_name, demo_key) natural identity,
--                           row_id pointing at the planted row,
--                           seed_version for future seed generations.
--                           The clear script deletes through this table, so
--                           clearing can only ever remove rows the seed
--                           planted -- never production data.
--   demo_admin_actions   -- append-only audit of seed/clear runs:
--                           action (seed|clear), actor_user, detail jsonb
--                           (per-table row counts), created_at. Written by
--                           the super-admin API routes, never by the seed
--                           scripts themselves (the scripts have no actor).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   The seed rows. Seeding lives in versioned scripts under
--   services/directus/seeds/demo/ (migrator-owned, run as directus_migrator
--   with SET ROLE, never directus_app). A migration that plants personal
--   data -- including minors -- on every deploy would make demo data
--   undeletable-by-design; the registry exists precisely so the seed is
--   repeatable AND removable.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. Registry PK is (table_name, demo_key): the clear script addresses
--      rows by the same natural keys the seed uses (DEMO- codes, ticket
--      codes, idempotency keys), so a row planted twice under one key is
--      one registry row, not two deletes.
--   2. directus_app gets SELECT + INSERT on both tables, no UPDATE, no
--      DELETE (append-only posture, same as welfare_case_events and
--      event_budgets): the portal may read what was seeded and may append
--      audit rows; it may never rewrite history or widen a delete. The
--      clear path runs as directus_migrator, never through the API role.
--   3. Sealed registers (incidents, legal_holds, retention_runs,
--      retention_run_items, retention_clocks, retention_policies,
--      member_otp_codes, member_sessions) have NO registry rows by
--      construction -- the seed never writes them -- and the clear script
--      raises instead of deleting if one ever appears. This migration does
--      not need to enumerate them; the guard lives with the delete.
--
-- GRANTS (expansion section 10 posture: one app identity; branch scoping
-- lives in the Directus policy + portal route filters, not here). This
-- layer states the ceiling only: directus_app SELECT + INSERT on both new
-- tables, no UPDATE, no DELETE. No durations, no awareness_at.
--
-- Rollback: rollback/20261105_0068_demo_seed_registry.down.sql (refuses
-- while demo_seed_registry holds rows -- clear first, loudly; drops the
-- audit table, then the registry, no CASCADE). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation or
-- superuser capability; only GRANT/REVOKE below.

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
-- 1. demo_seed_registry -- the clear script's address book.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_seed_registry (
  table_name   text NOT NULL,
  demo_key     text NOT NULL,
  row_id       uuid NOT NULL,
  seed_version text NOT NULL DEFAULT 'demo-1',
  seeded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_seed_registry_pkey PRIMARY KEY (table_name, demo_key)
);

COMMENT ON TABLE demo_seed_registry IS
  'Demo seed address book (AFC-1086). One row per row the demo seed planted; 002_demo_clear.sql deletes through row_id, so clearing can only remove planted rows. Sealed registers never appear here by construction.';

CREATE INDEX IF NOT EXISTS demo_seed_registry_table_idx
  ON demo_seed_registry (table_name);

-- ---------------------------------------------------------------------------
-- 2. demo_admin_actions -- append-only audit of seed/clear runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_admin_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action     text NOT NULL CHECK (action IN ('seed', 'clear')),
  actor_user uuid,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE demo_admin_actions IS
  'Append-only audit of demo seed/clear runs (AFC-1086). Written by the super-admin API routes with the actor and per-table row counts. No UPDATE, no DELETE: history is never rewritten.';
COMMENT ON COLUMN demo_admin_actions.actor_user IS
  'Portal user who ran the action (bare uuid: the audit names the actor, it never joins the session store). NULL only for operator psql runs, which are logged in NOTICE output instead.';

CREATE INDEX IF NOT EXISTS demo_admin_actions_action_idx
  ON demo_admin_actions (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT + INSERT for the app role on both
--    tables; no UPDATE, no DELETE anywhere in this file.
-- ---------------------------------------------------------------------------
GRANT SELECT ON demo_seed_registry TO directus_app;
GRANT INSERT (table_name, demo_key, row_id, seed_version)
  ON demo_seed_registry TO directus_app;

GRANT SELECT ON demo_admin_actions TO directus_app;
GRANT INSERT (action, actor_user, detail)
  ON demo_admin_actions TO directus_app;

REVOKE ALL ON demo_seed_registry FROM PUBLIC;
REVOKE ALL ON demo_admin_actions FROM PUBLIC;
