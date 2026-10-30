-- Migration 0062: funerals under Family (AFC-884, chairman direction
-- 2026-10-29).
--
-- Name of deceased (linkable to a person; linking flips the person to
-- deceased), checklist + uploads (death certificate, family consent
-- letter), music-director programme approval (songs for service of songs
-- and funeral), funeral date plus attendance for both days.
--
-- funeral_cases: one row per funeral. deceased_person is optional (the
-- dead may not be in the register); deceased_name covers that case and
-- at least one of the two is required. branch is required (a scopeless
-- funeral is invisible fail-closed, marriage-cases precedent); zone is
-- the route-stamped denorm (0044 choice-8: SET NULL, no scope trigger).
--
-- people.status gains 'deceased': the register's lifecycle is
-- active/archived, and a linked funeral stamps deceased (route-owned
-- write, never a bare UPDATE from the client). The widen follows the
-- 0045/0048 pattern (drop the auto-named CHECK if present, add a named
-- widened one). Rollback restores the two-value CHECK and refuses while
-- any deceased row exists.
--
-- Grants: SELECT/INSERT(col-list)/UPDATE(col-list)/DELETE for
-- directus_app (family-office content). REVOKE PUBLIC. No roles
-- provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-884). R2 CTO review on
-- the AFC-884 thread before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261029_0062_funerals.down.sql (refuses while rows
-- exist; restores the two-value people status CHECK only when no
-- deceased row exists). Owner: migration role (directus_migrator).
-- Never run as directus_app.

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
-- 1. OWNERSHIP PRECONDITION. New register + people widening: fail closed
--    if leftovers are owned by someone else.
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
         AND c.relname IN ('funeral_cases', 'people')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the funerals register: % is not owned by '
      'directus_migrator, and only an owner may replace or widen it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. people.status gains 'deceased'. Drop the auto-named two-value CHECK
--    if present, add the widened named one.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_status_check') THEN
    ALTER TABLE people DROP CONSTRAINT people_status_check;
    RAISE NOTICE 'people_status_check dropped (superseded by the widened set).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_status_lifecycle_check') THEN
    ALTER TABLE people ADD CONSTRAINT people_status_lifecycle_check
      CHECK (status IN ('active', 'archived', 'deceased'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. funeral_cases. One row per funeral.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funeral_cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch               uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  deceased_person      uuid REFERENCES people(id) ON DELETE SET NULL,
  deceased_name        text,
  stage                text NOT NULL DEFAULT 'reported'
                         CHECK (stage IN ('reported', 'approved', 'scheduled', 'held', 'cancelled')),
  death_certificate_file uuid,
  consent_letter_file  uuid,
  songs                jsonb NOT NULL DEFAULT '[]'::jsonb,
  programme_approved_by uuid,
  programme_approved_at timestamptz,
  service_of_songs_date date,
  funeral_date         date,
  service_of_songs_attendance integer CHECK (service_of_songs_attendance IS NULL OR service_of_songs_attendance >= 0),
  funeral_attendance   integer CHECK (funeral_attendance IS NULL OR funeral_attendance >= 0),
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funeral_cases_person_or_name CHECK (deceased_person IS NOT NULL OR (deceased_name IS NOT NULL AND btrim(deceased_name) <> '')),
  CONSTRAINT funeral_cases_approval_needs_programme CHECK (
    stage <> 'approved' OR (programme_approved_by IS NOT NULL AND jsonb_array_length(songs) >= 1)
  )
);

COMMENT ON TABLE funeral_cases IS
  'AFC-884: funerals under Family. Deceased link flips people.status to deceased (route-owned). Death certificate + family consent letter ride directus_files (plain uuid, no FK: system-owned). Songs JSON array. Music-director approval gates the approved stage with at least one song. Attendance is a staff-recorded headcount per day.';

CREATE INDEX IF NOT EXISTS funeral_cases_branch_idx ON funeral_cases (branch);
CREATE INDEX IF NOT EXISTS funeral_cases_stage_idx ON funeral_cases (stage);
CREATE INDEX IF NOT EXISTS funeral_cases_funeral_date_idx ON funeral_cases (funeral_date);

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. Plus UPDATE on people.status: the funeral
--    link flips the deceased row to deceased (route-owned write). This is
--    the first writer of that column, so the grant lives here, narrowly.
--    (Side effect, documented: the existing people archive/restore toggle
--    rides the same grant.)
-- ---------------------------------------------------------------------------
GRANT SELECT ON funeral_cases TO directus_app;
GRANT INSERT (branch, zone, deceased_person, deceased_name, stage, death_certificate_file, consent_letter_file, songs, service_of_songs_date, funeral_date, service_of_songs_attendance, funeral_attendance, notes, created_by)
  ON funeral_cases TO directus_app;
GRANT UPDATE (deceased_person, deceased_name, stage, death_certificate_file, consent_letter_file, songs, programme_approved_by, programme_approved_at, service_of_songs_date, funeral_date, service_of_songs_attendance, funeral_attendance, notes)
  ON funeral_cases TO directus_app;
GRANT DELETE ON funeral_cases TO directus_app;
GRANT UPDATE (status) ON people TO directus_app;

REVOKE ALL ON funeral_cases FROM PUBLIC;
