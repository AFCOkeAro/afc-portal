-- 20261020_0012_youth_celebrations.sql
--
-- Youth profiles + celebrations (Slice 3e). AFC-476 / AFC-463e, spec authority
-- docs/planning/data-model-expansion.md §§4.2-4.4, 6.1-6.2 and
-- docs/planning/prd-expansion.md §6 (US-Y1/US-Y2/US-Y3).
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no youth / celebration / previous-branch / milestone table exists in
-- services/directus/schema/migrations/):
--   youth_profiles          -- §6.1: 1-1 child of people (person UNIQUE).
--   youth_profile_events    -- explicit youth audit (created/updated/note).
--   celebrations            -- §6.2: birthdays, anniversaries, shout-outs with
--                              visibility + status lifecycle.
--   celebration_events      -- explicit celebration audit
--                              (created/approved/published/archived/note).
--   person_previous_branches -- §4.3: previous branches/roles with year range.
--   person_milestones       -- §4.4: spiritual milestones with date OR year.
--
-- WHAT THIS FILE ALTERs (people, owned by 20261006_0004 minimal anchor):
--   §4.2 additions: marital_status, marriage_date, occupation,
--   employment_status, education_level, institution, is_entrepreneur,
--   professional_status, is_youth, locality, sub_location,
--   previous_branch_note, gravatar_hash, avatar_url, person_type.
--   Every ALTER is ADD COLUMN IF NOT EXISTS / guarded constraint work,
--   NOTICE-loud, so a Directus-first database that already carries these
--   columns is hardened, not forked.
--
-- WITHHELD, STATED (issue orders the §4.2 status expansion; this file does
-- not do it): people.status stays the closed (active, archived) set from
-- 0004. tests/db/63_retention_privileges.sql pins that closure as a
-- retention control -- "archived is not a third spelling of deleted" -- and
-- asserts UPDATE people SET status = 'deceased' is refused (23514). The
-- §4.2 set contains 'deceased' plus six other terminal-sounding values, so
-- the expansion and the control directly contradict, and widening a
-- retention-closed enum to make a slice green is exactly the boundary
-- AGENTS.md rule 1 forbids widening. The columns land here; the status
-- expansion waits for an explicit CTO decision (escalated on AFC-476).
-- Suite 79 §79.6 pins the closed behaviour with a CONTESTED marker until
-- that decision lands.
--
-- CHOICE, STATED (issue: "audit trail"; spec §6 names no audit table): a
-- parallel events table per domain, following the welfare_case_events
-- precedent (0009) and the blessing_events precedent (0011), not silent
-- reliance on the Directus activity log. Visibility/status moves on a
-- celebration write a celebration_events row; youth create/update writes a
-- youth_profile_events row. A generic audit table shared across domains
-- would couple slices; per-domain tables keep the rollback boundary clean
-- (the down script drops exactly what this file creates).
--
-- CHOICE, STATED (youth_profiles.person delete behaviour): CASCADE. A youth
-- profile is a 1-1 extension of the person row, not a ministry fact about a
-- program: it is meaningless without its person, and an orphan profile
-- would retain a young person's PII past the person row. Branch/zone links
-- are denorm SET NULL (a zone delete clears the denorm, never the row).
-- celebrations.person is RESTRICT (a celebration names a person; deleting
-- the person while greetings reference them is refused, same posture as
-- welfare_cases.person). person_previous_branches.person and
-- person_milestones.person are CASCADE (history rows are meaningless
-- without their person; erasure of the person must take its history).
--
-- CHOICE, STATED (guardian consent for minors): enforced at the portal
-- route layer, not as a CHECK here. is_minor is Flow-derived
-- (data-model §2.3, youth.derive in expansion §13) and may lag the DOB
-- write inside one request; a CHECK on celebrations.guardian_consent could
-- not see the sibling people row's derived flag without a trigger, and this
-- history installs no opaque triggers (denorm via Flow, §13 posture, same
-- as 0003/0010/0011). The column is therefore a stored boolean the route
-- must set: celebrations for a minor are refused without
-- guardian_consent = true (register.post.ts guardian precedent). The suite
-- pins the column default (false) and the route contract pins the refusal.
--
-- CHOICE, STATED (recurring-date query): birthdays/anniversaries are
-- queried by month/day across years, so the migration carries a partial
-- functional index on (month, day) WHERE is_recurring. The list route
-- filters on that predicate; a full-table scan over celebrations is the
-- cost-lens failure this index exists to prevent.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   people / branches / zones / directus_users themselves. Parent tables are
--   referenced only where they exist (§2: each FK lands conditionally under
--   a FIXED constraint name, so the owning slice and this file agree; a
--   missing parent skips loudly rather than forking a table another slice
--   owns -- the 0003 merge-contract pattern). Rerunning this file after the
--   parents land completes the FKs.
--
-- GRANTS (expansion §10, matrix §11 rows `youth_profiles`, `celebrations`):
-- Postgres sees one app identity, so branch/zone scoping, the dept-head
-- 403, and the §11.1 marriage_date/DOB restriction live in the Directus
-- policy + portal route filters, not here. This layer states the ceiling
-- only: directus_app gets SELECT everywhere, INSERT/UPDATE on operational
-- columns, NO DELETE on any of the six tables (youth rows hold children's
-- PII; celebrations are audited greetings; erasure runs as
-- retention_worker, never through the API).
--
-- Rollback: rollback/20261020_0012_youth_celebrations.down.sql (refuses
-- while any created table holds rows; drops in dependency order, no
-- CASCADE; people columns are left in place -- widening a live people
-- table is not reversed by dropping columns that Directus rows may use).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
-- No durations, no awareness_at.

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
-- 1. people §4.2 additions (ALTER, never CREATE -- 0004 merge contract).
--    Runs only where people exists; every column is IF NOT EXISTS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping people §4.2 hardening: people not present.';
    RETURN;
  END IF;

  ALTER TABLE people ADD COLUMN IF NOT EXISTS marital_status text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS marriage_date date;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS occupation text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS employment_status text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS education_level text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS institution text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS is_entrepreneur boolean NOT NULL DEFAULT false;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS professional_status text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS is_youth boolean;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS locality text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS sub_location text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS previous_branch_note text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS gravatar_hash text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_url text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS person_type text;
  RAISE NOTICE 'people §4.2 columns ensured.';
END
$$;

-- people CHECKs, guarded so reruns and Directus-first databases converge.
-- people.status is deliberately NOT touched here (see the WITHHELD note in
-- the header): the (active, archived) closure from 0004 is a retention
-- control pinned by suite 63, and the §4.2 expansion contradicts it. Only
-- the new §4.2 value columns get CHECKs below.
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping people §4.2 CHECKs: people not present.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_marital_status_valid') THEN
    ALTER TABLE people
      ADD CONSTRAINT people_marital_status_valid
      CHECK (marital_status IS NULL OR marital_status IN
        ('single', 'married', 'widowed', 'divorced', 'separated', 'unspecified'));
    RAISE NOTICE 'people_marital_status_valid ensured.';
  ELSE
    RAISE NOTICE 'people_marital_status_valid already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_employment_status_valid') THEN
    ALTER TABLE people
      ADD CONSTRAINT people_employment_status_valid
      CHECK (employment_status IS NULL OR employment_status IN
        ('employed', 'self_employed', 'unemployed', 'student', 'retired', 'other'));
    RAISE NOTICE 'people_employment_status_valid ensured.';
  ELSE
    RAISE NOTICE 'people_employment_status_valid already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_education_level_valid') THEN
    ALTER TABLE people
      ADD CONSTRAINT people_education_level_valid
      CHECK (education_level IS NULL OR education_level IN
        ('none', 'primary', 'secondary', 'undergraduate', 'postgraduate', 'other'));
    RAISE NOTICE 'people_education_level_valid ensured.';
  ELSE
    RAISE NOTICE 'people_education_level_valid already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_person_type_valid') THEN
    ALTER TABLE people
      ADD CONSTRAINT people_person_type_valid
      CHECK (person_type IS NULL OR person_type IN ('visitor', 'member'));
    RAISE NOTICE 'people_person_type_valid ensured.';
  ELSE
    RAISE NOTICE 'people_person_type_valid already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS people_is_youth_idx ON people (is_youth)
  WHERE is_youth IS NOT NULL;
CREATE INDEX IF NOT EXISTS people_marital_status_idx ON people (marital_status)
  WHERE marital_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS people_education_level_idx ON people (education_level)
  WHERE education_level IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. youth_profiles (§6.1) + audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS youth_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person                uuid NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  education_level       text CHECK (education_level IS NULL OR education_level IN
                          ('primary', 'secondary', 'undergraduate', 'postgraduate', 'other')),
  institution           text,
  course                text,
  study_level           text CHECK (study_level IS NULL OR study_level IN
                          ('freshman', 'sophomore', 'junior', 'senior',
                           'final_year', 'graduated', 'n/a')),
  employment_status     text CHECK (employment_status IS NULL OR employment_status IN
                          ('student', 'employed', 'self_employed',
                           'unemployed', 'entrepreneur', 'other')),
  professional_status   text,
  is_entrepreneur       boolean NOT NULL DEFAULT false,
  youth_leadership_role text,
  branch                uuid,
  zone                  uuid,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE youth_profiles IS
  'Youth segment of the shared church DB (data-model-expansion §6.1, AFC-476). 1-1 child of people: person UNIQUE; CASCADE so an erased person takes its youth PII. branch/zone are scope denorm (Flow-maintained); status is the profile lifecycle, not the person status.';

CREATE INDEX IF NOT EXISTS youth_profiles_person_uidx ON youth_profiles (person);
CREATE INDEX IF NOT EXISTS youth_profiles_branch_idx ON youth_profiles (branch);
CREATE INDEX IF NOT EXISTS youth_profiles_zone_idx ON youth_profiles (zone);
CREATE INDEX IF NOT EXISTS youth_profiles_education_idx ON youth_profiles (education_level);
CREATE INDEX IF NOT EXISTS youth_profiles_employment_idx ON youth_profiles (employment_status);

CREATE TABLE IF NOT EXISTS youth_profile_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile     uuid NOT NULL REFERENCES youth_profiles(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'updated', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE youth_profile_events IS
  'Explicit youth audit (AFC-476; welfare_case_events precedent §6.3). Portal routes write created on link and updated on any edit.';

CREATE INDEX IF NOT EXISTS youth_profile_events_profile_created_idx
  ON youth_profile_events (profile, created_at);
CREATE INDEX IF NOT EXISTS youth_profile_events_profile_idx
  ON youth_profile_events (profile);

-- ---------------------------------------------------------------------------
-- 3. celebrations (§6.2) + audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS celebrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person           uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  type             text NOT NULL
                     CHECK (type IN
                       ('birthday', 'wedding_anniversary', 'academic_success',
                        'admission', 'graduation', 'scholarship', 'other')),
  event_date       date NOT NULL,
  is_recurring     boolean NOT NULL DEFAULT false,
  title            text,
  message          text,
  visibility       text NOT NULL DEFAULT 'internal'
                     CHECK (visibility IN ('internal', 'branch', 'public')),
  publish_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  branch           uuid,
  zone             uuid,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  guardian_consent boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Lifecycle guard (route layer enforces the transition graph; this CHECK
  -- rejects the one state that is never storable: a published greeting with
  -- no channel would read as sent and reach nobody).
  CONSTRAINT celebrations_published_needs_channel
    CHECK (status <> 'published'
           OR (publish_channels IS NOT NULL
               AND publish_channels <> '[]'::jsonb))
);

COMMENT ON TABLE celebrations IS
  'Birthdays, anniversaries and shout-outs (data-model-expansion §6.2, AFC-476). is_recurring marks month/day greetings (birthdays/anniversaries); status moves draft -> approved -> published -> archived. guardian_consent is the stored minor safeguard: the portal refuses a minor celebration without it (register.post.ts guardian precedent); visibility branch/zone scoping + the §11.1 DOB restriction live in the Directus policy + portal stripHidden, never in feed payloads.';

CREATE INDEX IF NOT EXISTS celebrations_person_idx ON celebrations (person);
CREATE INDEX IF NOT EXISTS celebrations_type_date_idx ON celebrations (type, event_date);
CREATE INDEX IF NOT EXISTS celebrations_branch_date_idx ON celebrations (branch, event_date);
CREATE INDEX IF NOT EXISTS celebrations_status_idx ON celebrations (status);
CREATE INDEX IF NOT EXISTS celebrations_visibility_idx ON celebrations (visibility);
-- Recurring-date predicate (cost lens): month/day lookup without a full scan.
CREATE INDEX IF NOT EXISTS celebrations_recurring_md_idx
  ON celebrations ((EXTRACT(MONTH FROM event_date)), ((EXTRACT(DAY FROM event_date))))
  WHERE is_recurring;

CREATE TABLE IF NOT EXISTS celebration_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celebration uuid NOT NULL REFERENCES celebrations(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN
                  ('created', 'approved', 'published', 'archived', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE celebration_events IS
  'Explicit celebration audit (AFC-476; welfare_case_events precedent). Portal routes write created/approved/published/archived on each lifecycle move.';

CREATE INDEX IF NOT EXISTS celebration_events_celebration_created_idx
  ON celebration_events (celebration, created_at);
CREATE INDEX IF NOT EXISTS celebration_events_celebration_idx
  ON celebration_events (celebration);

-- ---------------------------------------------------------------------------
-- 4. person_previous_branches (§4.3) + person_milestones (§4.4).
--    Youth-relevant history; created here only where no earlier migration
--    owns them (none does -- verified).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_previous_branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person      uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  branch_name text,
  branch      uuid,
  role        text,
  from_year   integer CHECK (from_year IS NULL OR (from_year BETWEEN 1900 AND 2100)),
  to_year     integer CHECK (to_year IS NULL OR (to_year BETWEEN 1900 AND 2100)),
  CONSTRAINT person_previous_branches_years_ordered
    CHECK (from_year IS NULL OR to_year IS NULL OR from_year <= to_year)
);

COMMENT ON TABLE person_previous_branches IS
  'Previous branches and roles with year ranges (data-model-expansion §4.3, AFC-476). CASCADE: history rows are meaningless without their person.';

CREATE INDEX IF NOT EXISTS person_previous_branches_person_idx
  ON person_previous_branches (person);

CREATE TABLE IF NOT EXISTS person_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  milestone_type text NOT NULL
                   CHECK (milestone_type IN
                     ('saved', 'sanctified', 'baptism_holy_ghost',
                      'water_baptism', 'other')),
  milestone_date date,
  milestone_year integer CHECK (milestone_year IS NULL OR (milestone_year BETWEEN 1900 AND 2100)),
  church         uuid,
  branch         uuid,
  notes          text,
  recorded_by    uuid,
  CONSTRAINT person_milestones_needs_when
    CHECK (milestone_date IS NOT NULL OR milestone_year IS NOT NULL)
);

COMMENT ON TABLE person_milestones IS
  'Spiritual milestones with a year fallback when the date is unknown (data-model-expansion §4.4, AFC-476). CASCADE: history rows are meaningless without their person.';

CREATE INDEX IF NOT EXISTS person_milestones_person_idx
  ON person_milestones (person);
CREATE INDEX IF NOT EXISTS person_milestones_person_type_idx
  ON person_milestones (person, milestone_type);

-- ---------------------------------------------------------------------------
-- 5. Conditional FKs onto parent tables owned elsewhere (the 0003
--    merge-contract pattern). Each lands only where the parent exists, under
--    a FIXED name so reruns and the contract test agree; a missing parent
--    skips loudly (the owning slice re-runs this migration when the table
--    lands). Branch links here are scope denorm: SET NULL, never RESTRICT --
--    the profile/celebration fact survives a branch re-mapping; the person
--    link above is the ownership edge and carries the real policy.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping youth/celebration branch FKs: branches not present (the hierarchy-owning slice re-runs this migration when the table lands).';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'youth_profiles_branch_fkey') THEN
      ALTER TABLE youth_profiles ADD CONSTRAINT youth_profiles_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'youth_profiles_branch_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'youth_profiles_branch_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'celebrations_branch_fkey') THEN
      ALTER TABLE celebrations ADD CONSTRAINT celebrations_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'celebrations_branch_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'celebrations_branch_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_previous_branches_branch_fkey') THEN
      ALTER TABLE person_previous_branches ADD CONSTRAINT person_previous_branches_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'person_previous_branches_branch_fkey ensured (SET NULL).';
    ELSE
      RAISE NOTICE 'person_previous_branches_branch_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_milestones_branch_fkey') THEN
      ALTER TABLE person_milestones ADD CONSTRAINT person_milestones_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'person_milestones_branch_fkey ensured (SET NULL).';
    ELSE
      RAISE NOTICE 'person_milestones_branch_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_milestones_church_fkey') THEN
      ALTER TABLE person_milestones ADD CONSTRAINT person_milestones_church_fkey
        FOREIGN KEY (church) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'person_milestones_church_fkey ensured (SET NULL).';
    ELSE
      RAISE NOTICE 'person_milestones_church_fkey already present, left alone.';
    END IF;
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping youth/celebration zone FKs: zones not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'youth_profiles_zone_fkey') THEN
      ALTER TABLE youth_profiles ADD CONSTRAINT youth_profiles_zone_fkey
        FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
      RAISE NOTICE 'youth_profiles_zone_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'youth_profiles_zone_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'celebrations_zone_fkey') THEN
      ALTER TABLE celebrations ADD CONSTRAINT celebrations_zone_fkey
        FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
      RAISE NOTICE 'celebrations_zone_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'celebrations_zone_fkey already present, left alone.';
    END IF;
  END IF;
END
$$;

-- Backfill the denorm where the branch parent is known. Rerunnable: only
-- rows whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.youth_profiles') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE youth_profiles y
       SET zone = br.zone
      FROM branches br
     WHERE y.zone IS NULL AND y.branch = br.id AND br.zone IS NOT NULL;
    UPDATE celebrations c
       SET zone = br.zone
      FROM branches br
     WHERE c.zone IS NULL AND c.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'youth/celebration zone denorm backfilled from branches.';
  ELSE
    RAISE NOTICE 'youth/celebration zone backfill skipped: table or branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    youth rows hold children's PII, celebrations are audited greetings,
--    and erasure runs as retention_worker, never through the API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON youth_profiles TO directus_app;
GRANT INSERT (person, education_level, institution, course, study_level,
  employment_status, professional_status, is_entrepreneur,
  youth_leadership_role, branch, zone, status)
  ON youth_profiles TO directus_app;
GRANT UPDATE (person, education_level, institution, course, study_level,
  employment_status, professional_status, is_entrepreneur,
  youth_leadership_role, branch, zone, status)
  ON youth_profiles TO directus_app;

GRANT SELECT ON youth_profile_events TO directus_app;
GRANT INSERT (profile, event_type, detail, actor_user)
  ON youth_profile_events TO directus_app;
GRANT UPDATE (detail) ON youth_profile_events TO directus_app;

GRANT SELECT ON celebrations TO directus_app;
GRANT INSERT (person, type, event_date, is_recurring, title, message,
  visibility, publish_channels, branch, zone, status, guardian_consent,
  created_by)
  ON celebrations TO directus_app;
GRANT UPDATE (person, type, event_date, is_recurring, title, message,
  visibility, publish_channels, branch, zone, status, guardian_consent,
  created_by)
  ON celebrations TO directus_app;

GRANT SELECT ON celebration_events TO directus_app;
GRANT INSERT (celebration, event_type, detail, actor_user)
  ON celebration_events TO directus_app;
GRANT UPDATE (detail) ON celebration_events TO directus_app;

GRANT SELECT ON person_previous_branches TO directus_app;
GRANT INSERT (person, branch_name, branch, role, from_year, to_year)
  ON person_previous_branches TO directus_app;
GRANT UPDATE (person, branch_name, branch, role, from_year, to_year)
  ON person_previous_branches TO directus_app;

GRANT SELECT ON person_milestones TO directus_app;
GRANT INSERT (person, milestone_type, milestone_date, milestone_year,
  church, branch, notes, recorded_by)
  ON person_milestones TO directus_app;
GRANT UPDATE (person, milestone_type, milestone_date, milestone_year,
  church, branch, notes, recorded_by)
  ON person_milestones TO directus_app;

REVOKE ALL ON youth_profiles FROM PUBLIC;
REVOKE ALL ON youth_profile_events FROM PUBLIC;
REVOKE ALL ON celebrations FROM PUBLIC;
REVOKE ALL ON celebration_events FROM PUBLIC;
REVOKE ALL ON person_previous_branches FROM PUBLIC;
REVOKE ALL ON person_milestones FROM PUBLIC;
