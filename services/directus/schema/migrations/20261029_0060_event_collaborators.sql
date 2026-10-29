-- Migration 0060: event collaborators (AFC-880, chairman direction
-- 2026-10-29).
--
-- Add collaborators to an event with permission on what they can change:
-- one row per (event, person) with a per-area grant list. Areas in v1:
-- details, schedule, speakers, resources, budget, registration. Tasks are
-- deliberately NOT an area: tasks attach to branches/people, not events,
-- and a per-event task grant would be unenforceable decoration.
--
-- Enforcement lives in the portal routes (server/utils/event-access.ts):
-- a scoped write passes when the caller's role grant passes (unchanged)
-- OR the caller is a collaborator on that event whose areas include the
-- write's area. Reads are unchanged. The route owns scope here (0044
-- choice-8: branch/zone are route-stamped denorms, SET NULL, no scope
-- trigger — the same precedent as the 0044 event_expenses register, so
-- suite 94 is untouched).
--
-- No FOREIGN KEY to people: people is retention-managed and owned by the
-- same migrator, but a hard FK would couple collaborator cleanup to the
-- retention erasure ladder; the route validates the person exists and the
-- unique (event, person) pair owns dedup. Event FK CASCADEs (programme
-- removed → its delegations go with it).
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app (programme admin
-- content; add/remove is the tool). REVOKE PUBLIC. No roles provisioned
-- (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-880). R2 CTO review on
-- the AFC-880 thread before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261029_0060_event_collaborators.down.sql
-- (refuses while rows exist; drops the table). Owner: migration role
-- (directus_migrator). Never run as directus_app.

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
-- 1. OWNERSHIP PRECONDITION. Brand-new register: fail closed if a leftover
--    table from a failed apply is owned by someone else.
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
         AND c.relname IN ('event_collaborators')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the collaborators register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. event_collaborators. One row per (event, person) with areas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_collaborators (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person               uuid NOT NULL,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  areas                text[] NOT NULL DEFAULT '{}',
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_collaborators_once UNIQUE (event, person),
  CONSTRAINT event_collaborators_areas CHECK (
    areas <@ ARRAY['details', 'schedule', 'speakers', 'resources', 'budget', 'registration']
  )
);

COMMENT ON TABLE event_collaborators IS
  'AFC-880: per-event collaborators with per-area grants (details/schedule/speakers/resources/budget/registration). branch/zone are route-stamped denorms (0044 choice-8 precedent, no scope trigger). No FK to people: retention-managed rows must not couple collaborator cleanup to the erasure ladder.';

CREATE INDEX IF NOT EXISTS event_collaborators_event_idx
  ON event_collaborators (event);
CREATE INDEX IF NOT EXISTS event_collaborators_person_idx
  ON event_collaborators (person);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT on the assignment
--    columns; UPDATE the areas; DELETE for removal. REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_collaborators TO directus_app;
GRANT INSERT (event, person, branch, zone, areas, created_by)
  ON event_collaborators TO directus_app;
GRANT UPDATE (areas)
  ON event_collaborators TO directus_app;
GRANT DELETE ON event_collaborators TO directus_app;

REVOKE ALL ON event_collaborators FROM PUBLIC;
