-- 20261020_0026_household_roles.sql
--
-- Household member roles (AFC-590, parent AFC-460).
-- Spec authority: docs/planning/data-model.md §2.3 (people.household M2O),
-- docs/planning/data-model-expansion.md §4.1 (household_head), and
-- packages/shared householdWizardSchema (head_of_household / spouse /
-- child / relative).
--
-- WHAT THIS FILE CREATES (verified: no household_role column exists on
-- people in services/directus/schema/ -- 0020 links people.household and
-- deliberately leaves the rest of the v4 people record to the
-- snapshot-owned Directus collection spec):
--   people.household_role -- the member's place in the family. Nullable:
--     rows written before the wizard have no role. CHECK-bound to the
--     four wizard roles so a misspelled role fails at write (23514),
--     never silently persists.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   A junction table or a second role system. people.household is already
--   the §2.3 membership link; the role is an attribute of that membership
--   and lives on the same row. households.household_head still names the
--   head (expansion §4.1); the wizard sets both from the head row.
--   No backfill: existing rows keep NULL (unknown), and the portal
--   renders NULL as "member". A reviewed backfill on personal data
--   (including minors) needs its own ticket + CTO approval.
--
-- CONDITIONAL OVERLAP: none. No earlier migration names household_role.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. Column on people, not on households: the role varies per member,
--      so it cannot live on the family row.
--   2. FK policy: none -- the role is an enum, not a link.
--   3. No NOT NULL, no default: history is unknown, not "relative".
--
-- SECURITY NOTE: this migration touches the people register (personal
-- data including minors). It only widens the 0020 ceiling by one UPDATE
-- column for directus_app (members are written through the portal, never
-- deleted here -- erasure runs as retention_worker). There is no
-- independent security reviewer on this team (board declined the seat on
-- cost); the CTO self-review of this migration is a recorded degradation,
-- not independent review. Do not treat a green gate as clearance.
--
-- GRANTS (expansion §10 posture: one app identity; branch scoping lives
-- in the Directus policy + portal route filters, not here). This layer
-- states the ceiling only: directus_app may UPDATE household_role (wizard
-- writes + corrections); no DELETE anywhere in this file.
--
-- Rollback: rollback/20261020_0026_household_roles.down.sql (refuses while
-- any row carries a non-null role). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation or
-- superuser capability; only GRANT below.
--
-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT below -- this file mints no roles (ADR-0002,
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
-- 1. people.household_role. ALTER, never CREATE TABLE: people is owned by
--    20261006_0004 (minimal anchor) under a merge contract that forbids a
--    fork. Only this slice's column lands here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE EXCEPTION
      'people is missing: 20261006_0004 must be applied before 20261020_0026. '
      'The retention anchor owns this table; this migration only extends it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE people ADD COLUMN IF NOT EXISTS household_role text;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_household_role_check') THEN
    ALTER TABLE people ADD CONSTRAINT people_household_role_check
      CHECK (household_role IS NULL OR household_role IN
        ('head_of_household', 'spouse', 'child', 'relative'));
    RAISE NOTICE 'people_household_role_check ensured (four wizard roles, NULL for pre-wizard rows).';
  ELSE
    RAISE NOTICE 'people_household_role_check already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS people_household_role_idx ON people (household_role)
  WHERE household_role IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Least-privilege ceiling. The app writes the role (wizard + corrections)
--    and reads it for the member list; erasure never runs through the API.
-- ---------------------------------------------------------------------------
GRANT UPDATE (household_role) ON people TO directus_app;
