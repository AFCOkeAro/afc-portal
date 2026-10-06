-- 20261006_0001_incidents.sql
--
-- The NDPA s.40(2) breach register substrate. AFC-166 / ADR-159-2 D7.
--
-- This file is deliberately the *base* table only: it is the state of the
-- world before awareness_at exists, which is what the backfill in
-- 20261006_0002 has to cope with. Splitting them keeps the backfill honest --
-- see docs/adr/ADR-0001-incidents-awareness-clock-origin.md.
--
-- Owner: migration role (directus_migrator). Never run as the Directus
-- runtime role -- see ADR-0001 "credential split".

CREATE TABLE IF NOT EXISTS incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text NOT NULL UNIQUE,
  summary           text NOT NULL,
  severity          text NOT NULL DEFAULT 'minor'
                      CHECK (severity IN ('minor', 'major', 'critical')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'investigating', 'contained', 'reported', 'closed')),
  branch_id         uuid,
  -- When engineering found it. May be AFTER awareness_at: staff can tell the
  -- board before engineering notices. Never constrain their order.
  detected_at       timestamptz,
  -- When the DPC notified the Commission / data subjects. Ordered after
  -- awareness_at by definition (enforced in 20261006_0002).
  reported_at       timestamptz,
  detected_by       text,
  acknowledged_at   timestamptz,
  contained_at      timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE incidents IS
  'NDPA s.40(2) breach register. Rows are evidence: they transition to closed, they are never deleted.';

CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_reported_at_idx ON incidents (reported_at)
  WHERE reported_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Roles and privileges.
--
-- Credential split (security lens, least privilege, default deny):
--   directus_migrator -- owns every table, runs migrations, never used by the app.
--   directus_app      -- the single DB identity Directus uses for EVERY API role.
--                        Because there is only one identity, the awareness_at
--                        control must be enforced by trigger, not by role
--                        permissions. These column grants are defence in depth.
-- ---------------------------------------------------------------------------
--
-- Both identities are BOOTSTRAP roles, provisioned by the cluster-owner
-- bootstrap step that runs BEFORE the migration sequence. This file asserts they
-- exist and then only ever GRANTs and REVOKEs against them.
--
-- ADR-0002. This block used to CREATE both roles. That is the defect
-- 20261006_0004_retention.sql exposed: because the sequence was privileged for
-- 0001 and unprivileged from 0002 onward, 0001 could mint a role and no later
-- migration could. The first migration that needed a NEW role failed with
-- 42501, and the obvious fix -- granting CREATEROLE to the migrator -- would
-- have let the migration identity promote itself to directus_app.
--
-- Roles are infrastructure. Migrations are history. See
-- services/directus/schema/bootstrap/README.md and scripts/migration-privilege-gate.sh,
-- which fails the build if any migration creates or escalates a role.
--
-- The assertion is fail-closed and names the missing role: a deploy that skips
-- bootstrap gets a sentence it can act on, not a silent partial install.
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
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration: '
      'migrations run as directus_migrator, which holds no CREATEROLE. Run the '
      'bootstrap before migrating -- see services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- Column-level grants on purpose: a table-level INSERT/UPDATE grant cannot be
-- narrowed at column level in PostgreSQL, so the safe form is to grant each
-- writable column explicitly and never name awareness_at / awareness_at_source.
-- Directus always emits explicit column lists, so this is transparent to it.
GRANT SELECT ON incidents TO directus_app;
GRANT INSERT (
  ref, summary, severity, status, branch_id,
  detected_at, reported_at, detected_by,
  acknowledged_at, contained_at, closed_at
) ON incidents TO directus_app;
GRANT UPDATE (
  ref, summary, severity, status, branch_id,
  detected_at, reported_at, detected_by,
  acknowledged_at, contained_at, closed_at
) ON incidents TO directus_app;
-- No DELETE grant, and 0002 adds a trigger that forbids DELETE anyway. Two
-- layers, both required to be removed before a row can disappear.

REVOKE ALL ON incidents FROM PUBLIC;