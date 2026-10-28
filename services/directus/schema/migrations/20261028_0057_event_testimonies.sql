-- Migration 0057: event testimonies (AFC-828 phase 4, chairman direction
-- 2026-10-29).
--
-- Public testimonies for the landing page (the chairman's "record
-- blessings"): one row per shared testimony (name, message, optional
-- contact for follow-up). Submitted session-free through the public
-- proxy route; staff read the scoped list on the event Reports >
-- Testimonies tab. No moderation state in phase 4; every submission is
-- visible to scoped staff and the public never lists testimonies.
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, from the parent event at write time).
-- No afc_set_scope trigger: a 32nd trigger would break the versioned
-- suite-94 pin, and the portal route owns scope here. Suite 94 is
-- untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app (programme admin
-- content; add/remove is the tool). REVOKE PUBLIC. No roles provisioned
-- (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-828). R2 CTO review on
-- the AFC-828 thread before landing (phase 4). No independent security
-- reviewer (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0057_event_testimonies.down.sql
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
         AND c.relname IN ('event_testimonies')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the testimonies register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. event_testimonies. One row per shared testimony.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_testimonies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  name                 text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 200),
  message              text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  contact              text CHECK (contact IS NULL OR char_length(contact) BETWEEN 1 AND 200),
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_testimonies IS
  'AFC-828 phase 4: public testimonies per event (public proxy writes, scoped staff reads on Reports > Testimonies). branch/zone are route-stamped denorms (0044 choice-8 precedent, no scope trigger). No moderation state in phase 4.';

CREATE INDEX IF NOT EXISTS event_testimonies_event_idx
  ON event_testimonies (event);
CREATE INDEX IF NOT EXISTS event_testimonies_created_idx
  ON event_testimonies (created_at);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT on the submission
--    columns; UPDATE/DELETE for programme admin. REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_testimonies TO directus_app;
GRANT INSERT (event, branch, zone, name, message, contact)
  ON event_testimonies TO directus_app;
GRANT UPDATE (name, message, contact)
  ON event_testimonies TO directus_app;
GRANT DELETE ON event_testimonies TO directus_app;

REVOKE ALL ON event_testimonies FROM PUBLIC;
