-- Migration 0061: session-linked resources (AFC-883, chairman direction
-- 2026-10-29).
--
-- Resources could only hang off the whole event. This adds an optional
-- session link so handouts can ride a specific session: participants
-- checked in to that session receive its resources plus the event-wide
-- shelf. Plain uuid FK to attendance_sessions with ON DELETE SET NULL:
-- deleting a session unlinks its handouts instead of destroying material
-- that may already have gone out (the 0023 merge-FK pattern would force
-- the rollback to know about this table; suite 86 parks this FK around
-- the 0021 empty rollback the same way it parks the event FKs).
--
-- Same-event rule is enforced in the route (a session from another
-- programme is refused), not by a cross-table CHECK the migrator cannot
-- re-assert cheaply. Grants: UPDATE (session_id) only; reads ride the
-- table SELECTs. REVOKE PUBLIC is table-level and already in force.
-- No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-883). R2 CTO review on
-- the AFC-883 thread before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261029_0061_session_resources.down.sql (refuses
-- while any session link is set; drops the column when clear). Owner:
-- migration role (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
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
-- 1. OWNERSHIP PRECONDITION. Fail closed if the register is owned by
--    someone else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('event_resources')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the session link: % is not owned by directus_migrator, '
      'and only an owner may alter it. Transfer ownership to '
      'directus_migrator first, then re-run this migration. Never widen '
      'the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. session_id on event_resources. Optional; same-event enforced in route.
-- ---------------------------------------------------------------------------
ALTER TABLE event_resources ADD COLUMN IF NOT EXISTS session_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_resources_session_fkey'
  ) THEN
    ALTER TABLE event_resources
      ADD CONSTRAINT event_resources_session_fkey
      FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN event_resources.session_id IS
  'AFC-883: optional session handout link (same event, route-enforced). SET NULL: deleting a session unlinks its handouts instead of destroying material.';

CREATE INDEX IF NOT EXISTS event_resources_session_idx
  ON event_resources (session_id) WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. UPDATE the link; reads ride the table SELECTs.
-- ---------------------------------------------------------------------------
GRANT UPDATE (session_id) ON event_resources TO directus_app;
