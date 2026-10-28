-- Migration 0051: outreach locations + location secretaries (AFC-841,
-- chairman direction 2026-10-28).
--
-- AVS pointed at Bible Study Centres, which is the wrong register (and
-- /bscs has no index page, so both AVS entries are dead links). The AVS
-- working surface is outreach locations: schools (primary/secondary,
-- private or government), prisons, skills learning centres, hospitals and
-- other mission fields. Each location carries its contact person
-- (name + phone), visiting days, and its assigned secretaries — at least
-- one per school.
--
-- Two registers: outreach_locations (one row per mission field) and
-- outreach_location_secretaries (location -> person junction; many
-- secretaries per location, one person secretarying many locations).
-- Secretaries are directory people, not a staff role: no new role is
-- provisioned (ADR-0002) and no role-matrix cell changes meaning.
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, from the caller's scope at write time).
-- No afc_set_scope trigger: a 29th trigger would break the versioned
-- suite-94 pin, and the portal route owns scope here the same way it does
-- for expenses. Suite 94 is untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app. DELETE is granted
-- here (unlike the attendance/financial registers): locations and
-- assignments are programme admin content, and add/remove is the tool. A
-- location delete cascades its secretary assignments. REVOKE PUBLIC.
-- No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-841). R2 CTO review on
-- the AFC-841 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0051_outreach_locations.down.sql
-- (refuses while rows exist; drops the junction, then the register).
-- Owner: migration role (directus_migrator). Never run as directus_app.

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
-- 1. OWNERSHIP PRECONDITION. Brand-new registers: fail closed if a leftover
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
         AND c.relname IN ('outreach_locations', 'outreach_location_secretaries')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the outreach registers: % is not owned by '
      'directus_migrator, and only an owner may replace them. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. outreach_locations. One row per mission field.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_locations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category             text NOT NULL
                         CHECK (category IN
                           ('primary_school', 'secondary_school', 'prison',
                            'skills_centre', 'hospital', 'other')),
  address              text,
  ownership            text NOT NULL DEFAULT 'private'
                         CHECK (ownership IN ('private', 'public')),
  contact_name         text,
  contact_phone        text,
  visiting_days        text,
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_locations_once UNIQUE (name, category)
);

COMMENT ON TABLE outreach_locations IS
  'AFC-841: AVS mission fields (schools, prisons, skills centres, hospitals). branch/zone are route-stamped denorms (0044 choice-8 precedent, no scope trigger). ownership names private vs government (public) fields.';

CREATE INDEX IF NOT EXISTS outreach_locations_branch_idx
  ON outreach_locations (branch);
CREATE INDEX IF NOT EXISTS outreach_locations_category_idx
  ON outreach_locations (category);

-- ---------------------------------------------------------------------------
-- 3. outreach_location_secretaries. Location -> person assignments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_location_secretaries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location             uuid NOT NULL REFERENCES outreach_locations(id) ON DELETE CASCADE,
  person               uuid REFERENCES people(id) ON DELETE SET NULL,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_location_secretaries_once UNIQUE (location, person)
);

COMMENT ON TABLE outreach_location_secretaries IS
  'AFC-841: secretaries assigned to outreach locations. Location delete cascades its assignments; a person delete clears the link, never the assignment row.';

CREATE INDEX IF NOT EXISTS outreach_location_secretaries_location_idx
  ON outreach_location_secretaries (location);
CREATE INDEX IF NOT EXISTS outreach_location_secretaries_person_idx
  ON outreach_location_secretaries (person) WHERE person IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns; DELETE granted (programme admin content --
--    add/remove is the tool; no audit trail on these registers).
--    REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON outreach_locations TO directus_app;
GRANT INSERT (branch, zone, name, category, address, ownership, contact_name, contact_phone, visiting_days, notes, created_by)
  ON outreach_locations TO directus_app;
GRANT UPDATE (branch, zone, name, category, address, ownership, contact_name, contact_phone, visiting_days, notes)
  ON outreach_locations TO directus_app;
GRANT DELETE ON outreach_locations TO directus_app;

GRANT SELECT ON outreach_location_secretaries TO directus_app;
GRANT INSERT (location, person, created_by)
  ON outreach_location_secretaries TO directus_app;
GRANT UPDATE (location, person)
  ON outreach_location_secretaries TO directus_app;
GRANT DELETE ON outreach_location_secretaries TO directus_app;

REVOKE ALL ON outreach_locations FROM PUBLIC;
REVOKE ALL ON outreach_location_secretaries FROM PUBLIC;
