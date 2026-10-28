-- Migration 0053: event speakers (AFC-843, chairman direction 2026-10-28).
--
-- A Speakers tab on the event page needs a register behind it: who is
-- booked vs pending, their special requests, and a short bio. Speakers
-- are directory people where possible; external guests carry a typed name
-- (person FK nullable, exactly one of person/external_name required).
--
-- Design: event_speakers (one row per booking) with status
-- invited/pending/booked/confirmed/declined. Resources a speaker shares
-- live in the AFC-844 register with a speaker FK — this slice only owns
-- the speaker side. No new staff role (ADR-0002).
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, from the parent event at write time).
-- No afc_set_scope trigger: a 30th trigger would break the versioned
-- suite-94 pin, and the portal route owns scope here. Suite 94 is
-- untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app. DELETE is granted
-- here (unlike the attendance/financial registers): bookings are
-- programme admin content, and add/remove is the tool. REVOKE PUBLIC.
-- No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-843). R2 CTO review on
-- the AFC-843 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0053_event_speakers.down.sql
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
         AND c.relname IN ('event_speakers')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the speakers register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. event_speakers. One row per booking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_speakers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  person               uuid REFERENCES people(id) ON DELETE SET NULL,
  external_name        text CHECK (external_name IS NULL OR char_length(external_name) BETWEEN 1 AND 200),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('invited', 'pending', 'booked', 'confirmed', 'declined')),
  special_requests     text,
  bio                  text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_speakers_person_or_name
    CHECK ((person IS NOT NULL AND external_name IS NULL)
        OR (person IS NULL AND external_name IS NOT NULL)),
  CONSTRAINT event_speakers_once UNIQUE (event, person, external_name)
);

COMMENT ON TABLE event_speakers IS
  'AFC-843: speaker bookings per event (directory person or typed external name, never both). branch/zone are route-stamped denorms from the parent event (0044 choice-8 precedent, no scope trigger). status tracks invited/pending/booked/confirmed/declined.';

CREATE INDEX IF NOT EXISTS event_speakers_event_idx
  ON event_speakers (event);
CREATE INDEX IF NOT EXISTS event_speakers_branch_idx
  ON event_speakers (branch);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns; DELETE granted (bookings are programme admin
--    content — add/remove is the tool; no audit trail on this register).
--    REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_speakers TO directus_app;
GRANT INSERT (event, branch, zone, person, external_name, status, special_requests, bio, created_by)
  ON event_speakers TO directus_app;
GRANT UPDATE (person, external_name, status, special_requests, bio)
  ON event_speakers TO directus_app;
GRANT DELETE ON event_speakers TO directus_app;

REVOKE ALL ON event_speakers FROM PUBLIC;
