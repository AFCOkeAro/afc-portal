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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_migrator') THEN
    -- No login: this role is assumed via SET ROLE by the migration runner, or
    -- granted to a deploy account. It never authenticates as itself.
    CREATE ROLE directus_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_app') THEN
    -- The Directus runtime identity. LOGIN because Directus authenticates with
    -- it; it owns nothing.
    CREATE ROLE directus_app LOGIN;
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