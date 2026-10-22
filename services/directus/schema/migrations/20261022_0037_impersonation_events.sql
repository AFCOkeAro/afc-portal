-- 20261022_0037_impersonation_events.sql
--
-- Scoped impersonation audit (AFC-684).
--
-- WHAT THIS FILE CREATES (nothing else -- verified: no impersonation_events
-- table exists in services/directus/schema/migrations/):
--   impersonation_events -- one row per preview start/stop: actor (required),
--                           target user XOR branch XOR zone (exactly one),
--                           action enum (started/stopped), reason (required,
--                           non-blank), started_at stamp.
--
-- CHOICE, STATED (issue: "every start/stop writes an audit row"): the portal
-- route is the writer; this table is the trail (welfare_case_events
-- precedent). The start path fails closed when the store is missing
-- (named 503 pending_migration_0037, never a silent start); the exit path
-- logs loudly and still restores the actor session so nobody is trapped in
-- a preview.
--
-- CHOICE, STATED (target references): bare uuid columns, no FK onto
-- directus_users / branches / zones. The portal writes the target id after
-- resolving it through a scoped Directus read, exactly like
-- office_minutes.file in 0013 and recorded_by in 0034. A FK onto a system
-- table would couple this audit to the auth store's lifecycle; the audit
-- must survive the target row.
--
-- CHOICE, STATED (exactly-one-target): CONSTRAINT
-- impersonation_events_single_target (num_nonnulls = 1). A row naming zero
-- targets explains nothing; a row naming two explains nothing twice.
--
-- GRANTS (expansion §10: impersonation is auth-critical, no matrix row):
-- Postgres sees one app identity, so scoping lives in the portal routes
-- (area-only list, zone-in-scope start). This layer states the ceiling only:
-- directus_app gets SELECT + INSERT, NO UPDATE / NO DELETE (audit rows are
-- append-only facts; corrections are new rows and erasure runs as
-- retention_worker, never through the API). REVOKE PUBLIC re-asserted.
--
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE. It needs no
-- CREATEROLE, no superuser, and no new privilege boundary: a red gate here
-- is actionable, a green gate bought by widening the boundary is not.
--
-- CTO APPROVAL REQUIRED before merge: this table stores auth-adjacent
-- personal data (actor + target ids, reason). There is no independent
-- security reviewer on this team (board declined the seat on cost), so a
-- CTO self-review is a recorded degradation, not independent review.

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
-- 1. impersonation_events. One row per start/stop; append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impersonation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor           uuid NOT NULL,
  target_user     uuid,
  target_branch   uuid,
  target_zone     uuid,
  action          text NOT NULL CHECK (action IN ('started', 'stopped')),
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  started_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impersonation_events_single_target
    CHECK (num_nonnulls(target_user, target_branch, target_zone) = 1)
);

COMMENT ON TABLE impersonation_events IS
  'Scoped impersonation audit (AFC-684). One row per start/stop: actor required, exactly one target (user XOR branch XOR zone), action started/stopped, reason required. Append-only; erasure runs as retention_worker.';

CREATE INDEX IF NOT EXISTS impersonation_events_actor_idx
  ON impersonation_events (actor, started_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Least-privilege ceiling (see header). Append-only: no UPDATE, no DELETE.
-- ---------------------------------------------------------------------------
GRANT SELECT ON impersonation_events TO directus_app;
GRANT INSERT (actor, target_user, target_branch, target_zone, action, reason)
  ON impersonation_events TO directus_app;

REVOKE ALL ON impersonation_events FROM PUBLIC;
