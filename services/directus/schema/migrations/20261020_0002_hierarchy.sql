-- 20261020_0002_hierarchy.sql
--
-- Organisation hierarchy (Slice 1). AFC-466 / AFC-461a, spec authority
-- docs/planning/data-model-expansion.md §2 and docs/planning/prd-expansion.md §1.
--
-- WHAT THIS FILE CREATES
--   areas, zones, branches, bible_study_centres, conference_centres,
--   sunday_school_classes, avs_centres, campus_institutions (reference only;
--   full campus care stays in Slice 5).
--
-- WHY branches IS CREATED HERE (not altered)
--   No earlier file in this history creates a `branches` table (verified:
--   only incidents, people-minimal, retention substrate and WECA finance
--   exist). The WECA migration (20261020_0001) deliberately left
--   branch_financial_records.branch and weca_returns.branch as bare uuids
--   with a merge contract: "the data-model migration that creates branches
--   must ALTER these tables to add the FK; it must not fork them." This file
--   IS that migration, so after creating the hierarchy it ALTERs both
--   finance tables to add the FK (guarded, NOTICE-loud). It creates no
--   second finance table.
--
-- WHY people IS ALTERED, NOT CREATED
--   20261006_0004 owns the minimal people anchor and forbids a fork ("the
--   data-model migration that lands later must ALTER TABLE ADD COLUMN, never
--   CREATE TABLE"). This file only ADDs columns to people where the table
--   exists. It adds nothing people needs for retention; the anchor is untouched.
--
-- TABLES THAT DO NOT EXIST YET (attendance_sessions, households,
-- directus_users in the scratch DB): the denorm/scope columns for those are
-- added CONDITIONALLY (DO block, IF to_regclass IS NOT NULL, NOTICE-loud).
-- The authoritative field list for the Directus project lives in
-- docs/planning/hierarchy-flows.md (the Flow spec); this file states the
-- SQL half. No opaque triggers: denorm is Flow-maintained (§13).
--
-- BRANCH_TYPE DEVIATION (recorded, not silent): the issue enum lists
-- full_fledged, afwc, semi_formed, worship_centre, main, satellite, other.
-- The live portal (packages/shared Branch, apps/web) already stores
-- area | main | branch | satellite. Excluding those would fail existing
-- rows, so the CHECK admits the union of both sets. New rows use the
-- issue enum; area/branch are legacy back-compat.
--
-- FK POLICY: hierarchy parents RESTRICT (a zone with branches is not
-- deleted by accident); person links SET NULL (a pastor leaving does not
-- delete the branch); denorm zone/area SET NULL (a zone delete clears the
-- denorm, never the row). No CASCADE anywhere in this file.
--
-- GRANTS (data-model-expansion.md §10, column 11.1): Postgres sees one app
-- identity, so branch/zone scoping lives in the Directus policy, not here.
-- This layer states the ceiling only: directus_app gets SELECT everywhere,
-- INSERT/UPDATE on operational columns, NO DELETE (church structure is
-- audited, like finance inputs). campus_institutions is reference data:
-- read-only to the app; rows land as reviewed migration/seed rows.
--
-- SEED: Lagos North (§seed below) is part of THIS file, not an ad-hoc
-- insert: 1 area, 6 zones, representative branches, 2-3 BSCs per sample
-- branch. Every INSERT is ON CONFLICT (code) DO NOTHING with FKs resolved
-- by code subselect, so the file reruns cleanly on a seeded database.
--
-- Rollback: rollback/20261020_0002_hierarchy.down.sql (refuses while any
-- hierarchy or finance row references the tables; drops in dependency order).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0004
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
-- 1. areas (§2.1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS areas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  code          text NOT NULL UNIQUE,
  overseer      uuid REFERENCES people(id) ON DELETE SET NULL,
  address       text,
  geo_lat       numeric(9,6),
  geo_lng       numeric(9,6),
  map_pin       jsonb,
  outdoor_photo uuid,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  sort          integer
);

COMMENT ON TABLE areas IS
  'Top of the hierarchy (data-model-expansion §2.1). Single row today: Lagos North.';

-- ---------------------------------------------------------------------------
-- 2. zones (§2.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area          uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  code          text NOT NULL UNIQUE,
  leader        uuid REFERENCES people(id) ON DELETE SET NULL,
  address       text,
  geo_lat       numeric(9,6),
  geo_lng       numeric(9,6),
  map_pin       jsonb,
  outdoor_photo uuid,
  year_started  integer CHECK (year_started IS NULL OR year_started BETWEEN 1900 AND 2100),
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  sort          integer
);

COMMENT ON TABLE zones IS
  'Six per area (data-model-expansion §2.2). Parent area RESTRICTs: a zone with branches is never deleted by accident.';

CREATE INDEX IF NOT EXISTS zones_area_idx ON zones (area);
CREATE INDEX IF NOT EXISTS zones_status_idx ON zones (status);

-- ---------------------------------------------------------------------------
-- 3. branches (§2.3). CREATED here (see header: no earlier file owns it).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  code             text NOT NULL UNIQUE,
  slug             text UNIQUE,
  zone             uuid NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  area             uuid REFERENCES areas(id) ON DELETE RESTRICT,
  branch_type      text NOT NULL DEFAULT 'full_fledged'
                     CHECK (branch_type IN
                       ('full_fledged', 'afwc', 'semi_formed', 'worship_centre',
                        'main', 'satellite', 'other',
                        'area', 'branch')),
  type_label       text CHECK (type_label IS NULL OR type_label IN ('FFC', 'AFWC')),
  parent_branch    uuid REFERENCES branches(id) ON DELETE SET NULL,
  pastor           uuid REFERENCES people(id) ON DELETE SET NULL,
  address          text,
  city             text,
  state            text,
  phone            text,
  email            text,
  geo_lat          numeric(9,6),
  geo_lng          numeric(9,6),
  map_pin          jsonb,
  outdoor_photo    uuid,
  pastor_photo     uuid,
  year_founded     integer CHECK (year_founded IS NULL OR year_founded BETWEEN 1900 AND 2100),
  notable_history  text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  sort             integer
);

COMMENT ON TABLE branches IS
  'Branches (data-model-expansion §2.3, AFC-147 §2.1 merged). zone is the hierarchy parent (required for new rows); area is denorm via zone (Flow-maintained). parent_branch is retained for satellites/outstations under a branch, distinct from zone.';

CREATE INDEX IF NOT EXISTS branches_zone_idx ON branches (zone);
CREATE INDEX IF NOT EXISTS branches_area_idx ON branches (area)
  WHERE area IS NOT NULL;
CREATE INDEX IF NOT EXISTS branches_branch_type_idx ON branches (branch_type);
CREATE INDEX IF NOT EXISTS branches_status_idx ON branches (status);

-- ---------------------------------------------------------------------------
-- 4. bible_study_centres (§2.4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bible_study_centres (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  code               text NOT NULL UNIQUE,
  parent_branch      uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  zone               uuid REFERENCES zones(id) ON DELETE SET NULL,
  leader             uuid REFERENCES people(id) ON DELETE SET NULL,
  location           text,
  address            text,
  geo_lat            numeric(9,6),
  geo_lng            numeric(9,6),
  map_pin            jsonb,
  property_type      text CHECK (property_type IS NULL OR property_type IN ('church', 'school', 'warehouse', 'other')),
  property_owner     text,
  year_founded       integer CHECK (year_founded IS NULL OR year_founded BETWEEN 1900 AND 2100),
  history            text,
  average_attendance integer CHECK (average_attendance IS NULL OR average_attendance >= 0),
  photo              uuid,
  status             text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE bible_study_centres IS
  'Bible Study Centres (data-model-expansion §2.4). parent_branch required; zone is denorm (Flow-maintained). Parent RESTRICTs: a branch with BSCs is never deleted by accident.';

CREATE INDEX IF NOT EXISTS bsc_parent_branch_idx ON bible_study_centres (parent_branch);
CREATE INDEX IF NOT EXISTS bsc_zone_status_idx ON bible_study_centres (zone, status);

-- ---------------------------------------------------------------------------
-- 5. conference_centres (§2.5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conference_centres (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  code               text NOT NULL UNIQUE,
  zone               uuid REFERENCES zones(id) ON DELETE SET NULL,
  branch             uuid REFERENCES branches(id) ON DELETE SET NULL,
  location           text,
  address            text,
  geo_lat            numeric(9,6),
  geo_lng            numeric(9,6),
  map_pin            jsonb,
  leader             uuid REFERENCES people(id) ON DELETE SET NULL,
  avs_count          integer CHECK (avs_count IS NULL OR avs_count >= 0),
  elementary_count   integer CHECK (elementary_count IS NULL OR elementary_count >= 0),
  year_started       integer CHECK (year_started IS NULL OR year_started BETWEEN 1900 AND 2100),
  headcount          integer CHECK (headcount IS NULL OR headcount >= 0),
  photo              uuid,
  status             text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE conference_centres IS
  'Conference centres (data-model-expansion §2.5). zone/branch links SET NULL: a venue outlives a re-mapping.';

CREATE INDEX IF NOT EXISTS conference_centres_zone_idx ON conference_centres (zone);
CREATE INDEX IF NOT EXISTS conference_centres_status_idx ON conference_centres (status);

-- ---------------------------------------------------------------------------
-- 6. sunday_school_classes (§2.6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sunday_school_classes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name     text NOT NULL,
  branch         uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone           uuid REFERENCES zones(id) ON DELETE SET NULL,
  teacher        uuid REFERENCES people(id) ON DELETE SET NULL,
  students_count integer CHECK (students_count IS NULL OR students_count >= 0),
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE sunday_school_classes IS
  'Sunday School classes (data-model-expansion §2.6). branch nullable: a class may be zonal/area-level.';

CREATE INDEX IF NOT EXISTS sunday_school_classes_branch_idx ON sunday_school_classes (branch);
CREATE INDEX IF NOT EXISTS sunday_school_classes_zone_idx ON sunday_school_classes (zone);
CREATE INDEX IF NOT EXISTS sunday_school_classes_teacher_idx ON sunday_school_classes (teacher);

-- ---------------------------------------------------------------------------
-- 7. avs_centres (§2.7).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avs_centres (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_name          text NOT NULL,
  branch               uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  address              text,
  geo_lat              numeric(9,6),
  geo_lng              numeric(9,6),
  map_pin              jsonb,
  school_contact_name  text,
  school_contact_phone text,
  contact_person       uuid REFERENCES people(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'regular'
                         CHECK (status IN ('regular', 'paused')),
  type                 text CHECK (type IS NULL OR type IN ('primary', 'secondary', 'others')),
  assets               text,
  notes                text,
  photo                uuid
);

COMMENT ON TABLE avs_centres IS
  'AVS centres (data-model-expansion §2.7). branch required and RESTRICTs. Secretaries are an M2M (avs_secretaries) owned by the Directus project, not this migration.';

CREATE INDEX IF NOT EXISTS avs_centres_branch_idx ON avs_centres (branch);
CREATE INDEX IF NOT EXISTS avs_centres_status_idx ON avs_centres (status);
CREATE INDEX IF NOT EXISTS avs_centres_type_idx ON avs_centres (type);

-- ---------------------------------------------------------------------------
-- 8. campus_institutions (§7.1, reference only — full campus care is Slice 5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus_institutions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  town        text,
  state       text,
  coordinator uuid REFERENCES people(id) ON DELETE SET NULL,
  notes       text,
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE campus_institutions IS
  'Campus reference only (data-model-expansion §7.1 lite, AFC-461a). Students, coaching and results arrive in Slice 5; this row exists so scope pages can name the institution without forking the model.';

-- ---------------------------------------------------------------------------
-- 9. WECA merge contract: branches now exists, so add the FKs the 0001 file
--    promised ("must ALTER these tables to add the FK; it must not fork
--    them"). Guarded: a database where 0001 was never applied gets a NOTICE,
--    not a failure, and the FK is simply absent until 0001 lands first.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.branch_financial_records') IS NULL THEN
    RAISE NOTICE 'Skipping WECA FK: branch_financial_records not present (apply 20261020_0001 first).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branch_financial_records_branch_fkey') THEN
    ALTER TABLE branch_financial_records
      ADD CONSTRAINT branch_financial_records_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'WECA FK added: branch_financial_records.branch -> branches(id) RESTRICT.';
  ELSE
    RAISE NOTICE 'WECA FK already present on branch_financial_records.branch, left alone.';
  END IF;

  IF to_regclass('public.weca_returns') IS NULL THEN
    RAISE NOTICE 'Skipping WECA FK: weca_returns not present (apply 20261020_0001 first).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weca_returns_branch_fkey') THEN
    ALTER TABLE weca_returns
      ADD CONSTRAINT weca_returns_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'WECA FK added: weca_returns.branch -> branches(id) RESTRICT.';
  ELSE
    RAISE NOTICE 'WECA FK already present on weca_returns.branch, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 10. Conditional scope/denorm columns on tables owned elsewhere.
--     Each block runs only where the table exists; otherwise a NOTICE names
--     the Directus field spec that remains the authority
--     (docs/planning/hierarchy-flows.md). No table is created here that
--     another migration owns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- people: owned by 20261006_0004 (minimal anchor). Hierarchy adds no
  -- retention column; branch/zone scoping for a person resolves through
  -- branch, so no ALTER is required. Recorded so a reviewer does not ask.
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'people not present; nothing to extend.';
  ELSE
    RAISE NOTICE 'people present; no hierarchy column required (person scope resolves through branch).';
  END IF;

  -- attendance_sessions: full v4 table not in schema history yet. The denorm
  -- columns (zone, bsc) land with it; if a project database already has the
  -- Directus collection, add them now.
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping attendance_sessions denorm: table not present. Directus fields zone (M2O zones), bsc (M2O bible_study_centres, nullable) per hierarchy-flows.md §2.';
  ELSE
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS bsc uuid REFERENCES bible_study_centres(id) ON DELETE SET NULL;
    RAISE NOTICE 'attendance_sessions denorm columns ensured (zone, bsc).';
  END IF;

  -- households: v4 table not in schema history yet. Same treatment.
  IF to_regclass('public.households') IS NULL THEN
    RAISE NOTICE 'Skipping households denorm: table not present. Directus fields zone (M2O zones), household_head (M2O people) per hierarchy-flows.md §3.';
  ELSE
    ALTER TABLE households ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
    ALTER TABLE households ADD COLUMN IF NOT EXISTS household_head uuid REFERENCES people(id) ON DELETE SET NULL;
    RAISE NOTICE 'households denorm columns ensured (zone, household_head).';
  END IF;

  -- directus_users: a Directus system table; the scratch DB never has it.
  -- Real project databases get the three scope columns; the sync Flow keeps
  -- zone_ids fresh (hierarchy-flows.md §4).
  IF to_regclass('public.directus_users') IS NULL THEN
    RAISE NOTICE 'Skipping directus_users scopes: system table not present. Directus fields area (M2O areas), zone (M2O zones), zone_ids (json array uuid) per hierarchy-flows.md §4.';
  ELSE
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS area uuid REFERENCES areas(id) ON DELETE SET NULL;
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS zone_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    RAISE NOTICE 'directus_users scope columns ensured (area, zone, zone_ids).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 11. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--     hierarchy rows are audited structure, like finance inputs.
-- ---------------------------------------------------------------------------
GRANT SELECT ON areas TO directus_app;
GRANT SELECT ON zones TO directus_app;
GRANT SELECT ON branches TO directus_app;
GRANT SELECT ON bible_study_centres TO directus_app;
GRANT SELECT ON conference_centres TO directus_app;
GRANT SELECT ON sunday_school_classes TO directus_app;
GRANT SELECT ON avs_centres TO directus_app;
GRANT SELECT ON campus_institutions TO directus_app;

GRANT INSERT (name, code, overseer, address, geo_lat, geo_lng, map_pin, outdoor_photo, status, sort) ON areas TO directus_app;
GRANT UPDATE (name, code, overseer, address, geo_lat, geo_lng, map_pin, outdoor_photo, status, sort) ON areas TO directus_app;

GRANT INSERT (area, name, code, leader, address, geo_lat, geo_lng, map_pin, outdoor_photo, year_started, status, sort) ON zones TO directus_app;
GRANT UPDATE (area, name, code, leader, address, geo_lat, geo_lng, map_pin, outdoor_photo, year_started, status, sort) ON zones TO directus_app;

GRANT INSERT (name, code, slug, zone, area, branch_type, type_label, parent_branch, pastor, address, city, state, phone, email, geo_lat, geo_lng, map_pin, outdoor_photo, pastor_photo, year_founded, notable_history, status, sort) ON branches TO directus_app;
GRANT UPDATE (name, code, slug, zone, area, branch_type, type_label, parent_branch, pastor, address, city, state, phone, email, geo_lat, geo_lng, map_pin, outdoor_photo, pastor_photo, year_founded, notable_history, status, sort) ON branches TO directus_app;

GRANT INSERT (name, code, parent_branch, zone, leader, location, address, geo_lat, geo_lng, map_pin, property_type, property_owner, year_founded, history, average_attendance, photo, status) ON bible_study_centres TO directus_app;
GRANT UPDATE (name, code, parent_branch, zone, leader, location, address, geo_lat, geo_lng, map_pin, property_type, property_owner, year_founded, history, average_attendance, photo, status) ON bible_study_centres TO directus_app;

GRANT INSERT (name, code, zone, branch, location, address, geo_lat, geo_lng, map_pin, leader, avs_count, elementary_count, year_started, headcount, photo, status) ON conference_centres TO directus_app;
GRANT UPDATE (name, code, zone, branch, location, address, geo_lat, geo_lng, map_pin, leader, avs_count, elementary_count, year_started, headcount, photo, status) ON conference_centres TO directus_app;

GRANT INSERT (class_name, branch, zone, teacher, students_count, status) ON sunday_school_classes TO directus_app;
GRANT UPDATE (class_name, branch, zone, teacher, students_count, status) ON sunday_school_classes TO directus_app;

GRANT INSERT (centre_name, branch, address, geo_lat, geo_lng, map_pin, school_contact_name, school_contact_phone, contact_person, status, type, assets, notes, photo) ON avs_centres TO directus_app;
GRANT UPDATE (centre_name, branch, address, geo_lat, geo_lng, map_pin, school_contact_name, school_contact_phone, contact_person, status, type, assets, notes, photo) ON avs_centres TO directus_app;

REVOKE ALL ON areas FROM PUBLIC;
REVOKE ALL ON zones FROM PUBLIC;
REVOKE ALL ON branches FROM PUBLIC;
REVOKE ALL ON bible_study_centres FROM PUBLIC;
REVOKE ALL ON conference_centres FROM PUBLIC;
REVOKE ALL ON sunday_school_classes FROM PUBLIC;
REVOKE ALL ON avs_centres FROM PUBLIC;
REVOKE ALL ON campus_institutions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 12. SEED — Lagos North (idempotent; ON CONFLICT (code) DO NOTHING).
--
-- 1 area, 6 zones, representative branches per zone with zone mapping, 2-3
-- BSCs per sample branch. Rerunnable: codes are the identity, FKs resolve
-- by code subselect, conflicts do nothing. No personal data: names are
-- place names, no emails, phones, or person links.
-- ---------------------------------------------------------------------------
INSERT INTO areas (name, code, status, sort) VALUES
  ('Lagos North Area', 'LAG-NORTH', 'active', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO zones (area, name, code, status, sort) VALUES
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Oke-Aro Zone',      'LAG-NORTH-Z1', 'active', 11),
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Legun Zone',        'LAG-NORTH-Z2', 'active', 12),
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Matogun Zone',      'LAG-NORTH-Z3', 'active', 13),
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Olomowewe Zone',    'LAG-NORTH-Z4', 'active', 14),
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Abule-Egba Zone',   'LAG-NORTH-Z5', 'active', 15),
  ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Sango-Ota Zone',    'LAG-NORTH-Z6', 'active', 16)
ON CONFLICT (code) DO NOTHING;

-- Representative branches, one or two per zone. The first four codes match
-- the board workbook branches used by the WECA suite (68) on purpose: the
-- same branch code means the same branch everywhere.
INSERT INTO branches (name, code, slug, zone, area, branch_type, type_label, status, sort) VALUES
  ('Oke-Aro', 'OKE-ARO', 'oke-aro',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'full_fledged', 'FFC', 'active', 101),
  ('Legun', 'LEGUN', 'legun',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'full_fledged', 'FFC', 'active', 102),
  ('Matogun', 'MATOGUN', 'matogun',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'afwc', 'AFWC', 'active', 103),
  ('Olomowewe', 'OLOMOWEWE', 'olomowewe',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'full_fledged', 'FFC', 'active', 104),
  ('Abule-Egba', 'ABULE-EGBA', 'abule-egba',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'semi_formed', NULL, 'active', 105),
  ('Sango-Ota', 'SANGO-OTA', 'sango-ota',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'worship_centre', NULL, 'active', 106),
  ('Oke-Aro Satellite', 'OKE-ARO-SAT-1', 'oke-aro-sat-1',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'satellite', NULL, 'active', 107)
ON CONFLICT (code) DO NOTHING;

-- Satellites hang under a branch (parent_branch), distinct from zone.
UPDATE branches SET parent_branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')
 WHERE code = 'OKE-ARO-SAT-1' AND parent_branch IS NULL;

-- 2-3 BSCs per sample branch.
INSERT INTO bible_study_centres (name, code, parent_branch, zone, location, status) VALUES
  ('Oke-Aro BSC 1', 'OKE-ARO-BSC-01',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'Oke-Aro', 'active'),
  ('Oke-Aro BSC 2', 'OKE-ARO-BSC-02',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'Oke-Aro', 'active'),
  ('Oke-Aro BSC 3', 'OKE-ARO-BSC-03',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'Oke-Aro', 'active'),
  ('Legun BSC 1', 'LEGUN-BSC-01',
   (SELECT id FROM branches WHERE code = 'LEGUN'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), 'Legun', 'active'),
  ('Legun BSC 2', 'LEGUN-BSC-02',
   (SELECT id FROM branches WHERE code = 'LEGUN'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), 'Legun', 'active'),
  ('Matogun BSC 1', 'MATOGUN-BSC-01',
   (SELECT id FROM branches WHERE code = 'MATOGUN'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), 'Matogun', 'active'),
  ('Matogun BSC 2', 'MATOGUN-BSC-02',
   (SELECT id FROM branches WHERE code = 'MATOGUN'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), 'Matogun', 'active'),
  ('Olomowewe BSC 1', 'OLOMOWEWE-BSC-01',
   (SELECT id FROM branches WHERE code = 'OLOMOWEWE'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), 'Olomowewe', 'active'),
  ('Olomowewe BSC 2', 'OLOMOWEWE-BSC-02',
   (SELECT id FROM branches WHERE code = 'OLOMOWEWE'), (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), 'Olomowewe', 'active')
ON CONFLICT (code) DO NOTHING;
