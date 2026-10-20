-- 20261020_0020_households_departments.sql
--
-- Households + departments + membership junction (AFC-566, parent AFC-460).
-- Spec authority: docs/planning/data-model.md §§2.2-2.5 + §7 (FK policy),
-- docs/planning/data-model-expansion.md §4.1 (household_head, zone,
-- wedding_date, status), packages/shared household/department zod schemas
-- (form fields, junction roles, deactivate-instead-of-delete), and the
-- portal routes under apps/web/server/api/{households,departments}/.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no CREATE TABLE for any of these exists in services/directus/schema/):
--   households           -- §2.5 + expansion §4.1 (household_head, zone,
--                           wedding_date, status). The family unit behind
--                           people.household.
--   departments          -- §2.2 (board-shaped; the portal builds no
--                           create/edit form, only list/detail/link).
--   people_departments   -- §2.4 junction: one row per (person, department),
--                           unique on the pair, role + status.
--   people.household     -- the §2.3 M2O link (ALTER, never CREATE TABLE,
--                           per the 0004 merge contract quoted below).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   people columns beyond household. The full v4 people record (~25 columns:
--   names, branch, membership_status, ...) is snapshot-owned (AFC-147) and
--   this file must not fork it. Only the household link this slice needs is
--   added, IF NOT EXISTS. people rows on staging already carry the rest.
--   events_departments: no portal route references it (verified by grep over
--   apps/web/server), so it is left for the slice that reads it.
--
-- CONDITIONAL OVERLAP, stated so a re-run stays silent:
--   0002 hierarchy §10 adds households.zone + households.household_head
--   IF NOT EXISTS where the table exists. This file creates the tables WITH
--   those columns, so those blocks become no-ops on re-run -- same treatment,
--   no fork. 0006 campaigns references departments/households as bare uuids
--   under its §5 merge contract; nothing to close from this side.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. departments.branch is nullable (null = area-wide, §2.2) with
--      ON DELETE RESTRICT: a branch with departments is not deleted by
--      accident. Same reasoning as 0010 §"hierarchy/branch parents RESTRICT".
--   2. Junction FKs are ON DELETE CASCADE both sides (data-model §7
--      "cascade junction"): a junction row is meaningless without its person
--      AND its department. Portal unlink still deactivates (status flip, no
--      DELETE grant); CASCADE only fires on a reviewed migrator hard delete.
--   3. households.status / people_departments.status default 'active' with
--      (active, inactive) CHECKs: the routes filter active/inactive/all and
--      re-link reactivates instead of colliding with the unique pair index.
--   4. No seed rows: departments are board-shaped data (per the schema
--      module header) and households are family data -- seeding either would
--      invent records on a surface that holds children's data.
--
-- GRANTS (expansion §10 posture: one app identity; branch scoping lives in
-- the Directus policy + portal route filters, not here). This layer states
-- the ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE on
-- operational columns, NO DELETE on any of the three tables (departments are
-- board facts, unlink deactivates, household moves clear the link -- erasure
-- runs as retention_worker, never through the API). people gains UPDATE on
-- the household column only (member link/unlink); every other people column
-- keeps the ceiling 0004 states. No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0020_households_departments.down.sql (refuses
-- while households or the junction hold rows, or any people.household link
-- is set; drops in dependency order, no CASCADE). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per ADR-0002:
-- this file provisions no roles and grants no role-creation or superuser
-- capability; only GRANT/REVOKE below.

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
-- 1. households (§2.5 + expansion §4.1). zone is Flow-maintained from branch;
--    household_head / primary_contact SET NULL (a person leaving never
--    deletes the family row); branch RESTRICT (stated choice 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS households (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text,
  branch           uuid REFERENCES branches(id) ON DELETE RESTRICT,
  zone             uuid REFERENCES zones(id) ON DELETE SET NULL,
  address          text,
  phone            text,
  wedding_date     date,
  household_head   uuid REFERENCES people(id) ON DELETE SET NULL,
  primary_contact  uuid REFERENCES people(id) ON DELETE SET NULL,
  notes            text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE households IS
  'Family units behind people.household (data-model §2.5, expansion §4.1, AFC-469/AFC-566). zone is Flow-maintained from branch; status defaults active server-side (toHouseholdPayload).';

CREATE INDEX IF NOT EXISTS households_branch_idx ON households (branch);
CREATE INDEX IF NOT EXISTS households_status_idx ON households (status);
CREATE INDEX IF NOT EXISTS households_primary_contact_idx ON households (primary_contact)
  WHERE primary_contact IS NOT NULL;
CREATE INDEX IF NOT EXISTS households_zone_idx ON households (zone)
  WHERE zone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. departments (§2.2, board-shaped). branch null = area-wide; leader SET
--    NULL (a leader leaving never deletes the department).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  code             text UNIQUE,
  department_type  text
                     CHECK (department_type IS NULL OR department_type IN
                       ('youth', 'teens', 'worship', 'welfare', 'outreach',
                        'children', 'media', 'ushering', 'admin')),
  branch           uuid REFERENCES branches(id) ON DELETE RESTRICT,
  leader_person    uuid REFERENCES people(id) ON DELETE SET NULL,
  description      text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE departments IS
  'Ministry departments (data-model §2.2, AFC-469/AFC-566). Board-shaped: the portal builds list/detail/link only, no create/edit form. branch null = area-wide.';

CREATE INDEX IF NOT EXISTS departments_branch_idx ON departments (branch);
CREATE INDEX IF NOT EXISTS departments_type_idx ON departments (department_type)
  WHERE department_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS departments_status_idx ON departments (status);

-- ---------------------------------------------------------------------------
-- 3. people_departments (§2.4 junction). UNIQUE pair; re-link reactivates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people_departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  people           uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  departments      uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'member'
                     CHECK (role IN ('member', 'leader', 'assistant')),
  joined_at        date,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_departments_pair_uidx UNIQUE (people, departments)
);

COMMENT ON TABLE people_departments IS
  'Department membership (data-model §2.4, AFC-469/AFC-566). One row per (person, department); unlink sets inactive, re-link reactivates -- history survives.';

CREATE INDEX IF NOT EXISTS people_departments_people_idx ON people_departments (people);
CREATE INDEX IF NOT EXISTS people_departments_departments_idx ON people_departments (departments);

-- ---------------------------------------------------------------------------
-- 4. people.household (§2.3 M2O). ALTER, never CREATE TABLE: people is owned
--    by 20261006_0004 (minimal anchor) under a merge contract that forbids a
--    fork ("the data-model migration that lands later must ALTER TABLE ADD
--    COLUMN, never CREATE TABLE"). The full v4 people record stays
--    snapshot-owned (AFC-147); only this slice's link lands here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE EXCEPTION
      'people is missing: 20261006_0004 must be applied before 20261020_0020. '
      'The retention anchor owns this table; this migration only links it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE people ADD COLUMN IF NOT EXISTS household uuid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_household_fkey') THEN
    ALTER TABLE people ADD CONSTRAINT people_household_fkey
      FOREIGN KEY (household) REFERENCES households(id) ON DELETE SET NULL;
    RAISE NOTICE 'people_household_fkey ensured (household delete clears the link, never the person).';
  ELSE
    RAISE NOTICE 'people_household_fkey already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS people_household_idx ON people (household)
  WHERE household IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Least-privilege ceiling. No DELETE anywhere in this file.
-- ---------------------------------------------------------------------------
GRANT SELECT ON households TO directus_app;
GRANT INSERT (name, branch, zone, address, phone, wedding_date,
  household_head, primary_contact, notes, status)
  ON households TO directus_app;
GRANT UPDATE (name, branch, zone, address, phone, wedding_date,
  household_head, primary_contact, notes, status)
  ON households TO directus_app;

GRANT SELECT ON departments TO directus_app;
GRANT INSERT (name, code, department_type, branch, leader_person,
  description, status)
  ON departments TO directus_app;
GRANT UPDATE (name, code, department_type, branch, leader_person,
  description, status)
  ON departments TO directus_app;

GRANT SELECT ON people_departments TO directus_app;
GRANT INSERT (people, departments, role, joined_at, status)
  ON people_departments TO directus_app;
GRANT UPDATE (role, joined_at, status)
  ON people_departments TO directus_app;

GRANT UPDATE (household) ON people TO directus_app;

REVOKE ALL ON households FROM PUBLIC;
REVOKE ALL ON departments FROM PUBLIC;
REVOKE ALL ON people_departments FROM PUBLIC;
