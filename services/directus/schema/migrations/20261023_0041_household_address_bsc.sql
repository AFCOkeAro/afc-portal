-- 20261023_0041_household_address_bsc.sql
--
-- Structured household address + per-member BSC link (AFC-771, parent AFC-460).
-- Spec authority: AFC-771 §§2-3 (structured address_1..country + lat/long;
-- people.bsc M2O to bible_study_centres, nullable), packages/shared
-- householdWizardSchema (the new fields), and the portal wizard route
-- (compose legacy address; scope-check BSC).
--
-- WHAT THIS FILE CREATES (verified: no address_1/bsc columns exist on
-- households/people in services/directus/schema/):
--   households.address_1, address_2, city, state, zip, country (text),
--     latitude / longitude (numeric(9,6), range-checked like BSC geo).
--   households.address backfill: address_1 takes the legacy text where
--     present, so the old readable value survives the column split.
--   people.bsc -- nullable uuid REFERENCES bible_study_centres(id)
--     ON DELETE SET NULL (a closed centre never deletes the person).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No middle_name / suffix columns on people: the wizard maps
--   middle_name → people.other_names and appends suffix to last_name
--   (stated in the route header). No new status enum: per-member status
--   reuses the existing MEMBERSHIP_STATUSES set, enforced in zod.
--   No zone backfill: zone stays Flow-maintained from branch (§2 gate).
--
-- CONDITIONAL OVERLAP, stated so a re-run stays silent:
--   0002 hierarchy owns bible_study_centres (the FK referent); this file
--   only references it, guarded by to_regclass with a naming sentence.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. Legacy `households.address` is KEPT and stays written: the route
--      composes it from the structured parts, so pre-wizard readers and
--      the detail page keep a readable line with no migration of reads.
--   2. latitude/longitude are numeric(9,6) with range CHECKs, the same
--      shape as bible_study_centres geo (0002) — one geo shape, not two.
--   3. people.bsc is nullable with no default: history is unknown, not
--      "no centre". ON DELETE SET NULL for the same reason as
--      household_head (a departing link never deletes family facts).
--
-- SECURITY NOTE: this migration touches the households register and adds
-- a person link (personal data including minors). It widens the 0020
-- ceiling by app INSERT/UPDATE on the new address columns + bsc only;
-- no DELETE anywhere. There is no independent security reviewer on this
-- team (board declined the seat on cost); the CTO self-review of this
-- migration is a recorded degradation, not independent review. Do not
-- treat a green gate as clearance. Staging-first: apply per the rebuild
-- chain with a backup before apply (AFC-771 gates).
--
-- GRANTS (expansion §10 posture: one app identity; branch scoping lives
-- in the Directus policy + portal route filters, not here). This layer
-- states the ceiling only: directus_app gains INSERT/UPDATE on the new
-- households address columns and on people.bsc; SELECT on both tables
-- is already table-wide (0004/0020), so the new columns inherit reads
-- under the existing household grants (geo is staff-only by those
-- grants: volunteers hold NONE on households).
--
-- Rollback: rollback/20261023_0041_household_address_bsc.down.sql
-- (refuses while any bsc or geo pin holds data — those have no legacy
-- copy; structured text drops freely because the composed legacy
-- address carries the same words). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation
-- or superuser capability; only GRANT below.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT below -- this file mints no roles (ADR-0002,
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
-- 1. households structured address + geo. ALTER, never CREATE TABLE:
--    households is owned by 20261020_0020; only this slice's columns land.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.households') IS NULL THEN
    RAISE EXCEPTION
      'households is missing: 20261020_0020 must be applied before 20261023_0041. '
      'That migration owns this table; this migration only extends it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE households ADD COLUMN IF NOT EXISTS address_1 text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS address_2 text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS city text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS state text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS zip text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS country text;
  ALTER TABLE households ADD COLUMN IF NOT EXISTS latitude numeric(9,6);
  ALTER TABLE households ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_lat_check') THEN
    ALTER TABLE households ADD CONSTRAINT households_lat_check
      CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90));
    RAISE NOTICE 'households_lat_check ensured (decimal degrees, NULL when unpinned).';
  ELSE
    RAISE NOTICE 'households_lat_check already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_lng_check') THEN
    ALTER TABLE households ADD CONSTRAINT households_lng_check
      CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));
    RAISE NOTICE 'households_lng_check ensured (decimal degrees, NULL when unpinned).';
  ELSE
    RAISE NOTICE 'households_lng_check already present, left alone.';
  END IF;

  -- Backfill: the legacy line becomes address_1 where present. New
  -- writes keep composing legacy `address` from the parts, so this
  -- copy never goes stale in either direction.
  UPDATE households
     SET address_1 = address
   WHERE address_1 IS NULL
     AND address IS NOT NULL
     AND btrim(address) <> '';
  RAISE NOTICE 'households.address backfilled into address_1 where present.';
END
$$;

CREATE INDEX IF NOT EXISTS households_city_idx ON households (city)
  WHERE city IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. people.bsc. ALTER, never CREATE TABLE: people is owned by
--    20261006_0004 under a merge contract that forbids a fork. The BSC
--    table itself is owned by 0002 hierarchy; only the link lands here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE EXCEPTION
      'people is missing: 20261006_0004 must be applied before 20261023_0041. '
      'The retention anchor owns this table; this migration only links it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF to_regclass('public.bible_study_centres') IS NULL THEN
    RAISE EXCEPTION
      'bible_study_centres is missing: 20261020_0002 must be applied before 20261023_0041. '
      'The hierarchy migration owns that table; this migration only references it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE people ADD COLUMN IF NOT EXISTS bsc uuid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_bsc_fkey') THEN
    ALTER TABLE people ADD CONSTRAINT people_bsc_fkey
      FOREIGN KEY (bsc) REFERENCES bible_study_centres(id) ON DELETE SET NULL;
    RAISE NOTICE 'people_bsc_fkey ensured (a closed centre clears the link, never the person).';
  ELSE
    RAISE NOTICE 'people_bsc_fkey already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS people_bsc_idx ON people (bsc)
  WHERE bsc IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. The app writes the new address columns
--    (wizard + corrections) and the member BSC link; it deletes nothing.
-- ---------------------------------------------------------------------------
GRANT INSERT (address_1, address_2, city, state, zip, country, latitude, longitude)
  ON households TO directus_app;
GRANT UPDATE (address_1, address_2, city, state, zip, country, latitude, longitude)
  ON households TO directus_app;

GRANT INSERT (bsc) ON people TO directus_app;
GRANT UPDATE (bsc) ON people TO directus_app;
