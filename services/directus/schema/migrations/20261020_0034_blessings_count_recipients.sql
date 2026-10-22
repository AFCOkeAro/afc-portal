-- 20261020_0034_blessings_count_recipients.sql
--
-- Blessings single-count + individual mapping (AFC-671).
--
-- WHAT THIS FILE CREATES / CHANGES (nothing else):
--   blessings.count              -- single count per type (no male/female split).
--   blessing_recipients          -- individual blessing rows mapped to a DB
--                                  person (people FK RESTRICT) or an attendee
--                                  user, linked to a service or event.
--
-- CHOICE, STATED (single-count path): ADD a `count` column; KEEP male_count /
-- female_count with no data loss (deprecated, read-only at the API layer).
-- GENERATED total_count (male+female) is PRESERVED untouched so the 0011
-- contract and all existing rows keep working. New writes mirror
-- male_count = count, female_count = 0, so total_count always equals count
-- with no schema break. Backfill: count = male_count + female_count
-- (rerunnable: only rows where count diverges move).
--
-- CHOICE, STATED (recipients link): blessing FK is nullable + CASCADE (a
-- recipient may stand alone with its own blessing_type, or attach to an
-- aggregate blessing row; deleting the aggregate removes its linked
-- individuals). person FK is RESTRICT (a person with blessings is not
-- deleted by accident). attendee_user is a bare uuid with no FK (Directus
-- system users owned elsewhere, same posture as recorded_by in 0011).
-- Program links (session/event/sunday_service) are SET NULL (the fact
-- survives a program correction). Branch is RESTRICT; zone/bsc denorm are
-- SET NULL. At-least-one-person CHECK enforces the mapping. The expression
-- UNIQUE index gives idempotency per person+type+program+date; NULLs are
-- coalesced to a sentinel so two NULL program links collide (Postgres
-- UNIQUE treats NULLs as distinct without it).
--
-- GRANTS (expansion §10, matrix row `blessings`): Postgres sees one app
-- identity; scoping lives in the portal routes. This layer states the
-- ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE on
-- operational columns, NO DELETE on either object. REVOKE PUBLIC re-asserted.
--
-- Rollback: rollback/20261020_0034_blessings_count_recipients.down.sql
-- (refuses while blessing_recipients holds rows; drops the table + index,
-- then the count column only when it carries no diverged data).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: provisions no roles, grants no role-creation
-- or superuser capability; only GRANT/REVOKE on tables.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
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
-- 1. blessings.count — single count per type.
-- ---------------------------------------------------------------------------
ALTER TABLE blessings ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_count_nonnegative') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_count_nonnegative
      CHECK (count >= 0);
  END IF;
END
$$;

-- Rerunnable backfill: only rows where count diverges from male+female move.
UPDATE blessings SET count = male_count + female_count
 WHERE count <> male_count + female_count;

COMMENT ON COLUMN blessings.count IS
  'Single count per blessing type (AFC-671, no male/female split). Backfilled as male+female; new writes mirror male=count, female=0 so GENERATED total stays equal. male/female kept for history, deprecated read-only at the API.';

-- Least-privilege ceiling: extend the 0011 column lists with exactly `count`.
GRANT INSERT (count) ON blessings TO directus_app;
GRANT UPDATE (count) ON blessings TO directus_app;

REVOKE ALL ON blessings FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. blessing_recipients — one row per person per blessing type per program.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blessing_recipients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blessing           uuid,
  blessing_type      text NOT NULL
                       CHECK (blessing_type IN
                         ('salvation', 'sanctification', 'baptism_holy_ghost',
                          'reanointing', 'healing', 'other')),
  other_label        text,
  person             uuid,
  attendee_user      uuid,
  branch             uuid NOT NULL,
  zone               uuid,
  bsc                uuid,
  session            uuid,
  event              uuid,
  sunday_service     uuid,
  service_date       date NOT NULL,
  recorded_by        uuid,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blessing_recipients_needs_person
    CHECK (person IS NOT NULL OR attendee_user IS NOT NULL),
  CONSTRAINT blessing_recipients_other_needs_label
    CHECK (blessing_type <> 'other'
           OR (other_label IS NOT NULL
               AND btrim(other_label) <> ''))
);

COMMENT ON TABLE blessing_recipients IS
  'Individual blessings mapped to a DB person or attendee user (AFC-671). One person maps to one or many blessing types; rows aggregate alongside blessings counts. blessing FK nullable CASCADE; person RESTRICT; program links SET NULL.';

-- Idempotent entry key: one person, one type, one program, one date.
CREATE UNIQUE INDEX IF NOT EXISTS blessing_recipients_unique_entry
  ON blessing_recipients
  (branch, service_date, blessing_type,
   COALESCE(other_label, ''),
   COALESCE(person::text, ''), COALESCE(attendee_user::text, ''),
   COALESCE(session::text, ''), COALESCE(event::text, ''),
   COALESCE(sunday_service::text, ''));

CREATE INDEX IF NOT EXISTS blessing_recipients_branch_idx
  ON blessing_recipients (branch);
CREATE INDEX IF NOT EXISTS blessing_recipients_branch_date_idx
  ON blessing_recipients (branch, service_date);
CREATE INDEX IF NOT EXISTS blessing_recipients_person_idx
  ON blessing_recipients (person) WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS blessing_recipients_blessing_idx
  ON blessing_recipients (blessing) WHERE blessing IS NOT NULL;
CREATE INDEX IF NOT EXISTS blessing_recipients_service_date_idx
  ON blessing_recipients (service_date);
CREATE INDEX IF NOT EXISTS blessing_recipients_type_idx
  ON blessing_recipients (blessing_type);

-- Conditional FKs onto parent tables owned elsewhere (the 0011 merge-contract
-- pattern). Each lands only where the parent exists, under a FIXED name; a
-- missing parent skips loudly rather than forking a table another slice owns.
DO $$
BEGIN
  IF to_regclass('public.blessings') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_blessing_fkey: blessings not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_blessing_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_blessing_fkey
      FOREIGN KEY (blessing) REFERENCES blessings(id) ON DELETE CASCADE;
    RAISE NOTICE 'blessing_recipients_blessing_fkey ensured (CASCADE: linked individuals follow their aggregate).';
  ELSE
    RAISE NOTICE 'blessing_recipients_blessing_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_person_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_person_fkey
      FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
    RAISE NOTICE 'blessing_recipients_person_fkey ensured (RESTRICT: a person with blessings is not deleted by accident).';
  ELSE
    RAISE NOTICE 'blessing_recipients_person_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_branch_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'blessing_recipients_branch_fkey ensured (RESTRICT).';
  ELSE
    RAISE NOTICE 'blessing_recipients_branch_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_zone_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessing_recipients_zone_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'blessing_recipients_zone_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.bible_study_centres') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_bsc_fkey: bible_study_centres not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_bsc_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_bsc_fkey
      FOREIGN KEY (bsc) REFERENCES bible_study_centres(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessing_recipients_bsc_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'blessing_recipients_bsc_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_session_fkey: attendance_sessions not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_session_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessing_recipients_session_fkey ensured (program link SET NULL).';
  ELSE
    RAISE NOTICE 'blessing_recipients_session_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_event_fkey: events not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_event_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_event_fkey
      FOREIGN KEY (event) REFERENCES events(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessing_recipients_event_fkey ensured (program link SET NULL).';
  ELSE
    RAISE NOTICE 'blessing_recipients_event_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.sunday_services') IS NULL THEN
    RAISE NOTICE 'Skipping blessing_recipients_sunday_service_fkey: sunday_services not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_sunday_service_fkey') THEN
    ALTER TABLE blessing_recipients ADD CONSTRAINT blessing_recipients_sunday_service_fkey
      FOREIGN KEY (sunday_service) REFERENCES sunday_services(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessing_recipients_sunday_service_fkey ensured (program link SET NULL).';
  ELSE
    RAISE NOTICE 'blessing_recipients_sunday_service_fkey already present, left alone.';
  END IF;
END
$$;

-- Backfill the denorm where the branch parent is known. Rerunnable.
DO $$
BEGIN
  IF to_regclass('public.blessing_recipients') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE blessing_recipients b
       SET zone = br.zone
      FROM branches br
     WHERE b.zone IS NULL AND b.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'blessing_recipients zone denorm backfilled from branches.';
  ELSE
    RAISE NOTICE 'blessing_recipients zone backfill skipped: table or branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling for blessing_recipients. No DELETE: individual
--    blessings are ministry facts; erasure runs as retention_worker.
-- ---------------------------------------------------------------------------
GRANT SELECT ON blessing_recipients TO directus_app;
GRANT INSERT (blessing, blessing_type, other_label, person, attendee_user,
  branch, zone, bsc, session, event, sunday_service, service_date,
  recorded_by, notes)
  ON blessing_recipients TO directus_app;
GRANT UPDATE (blessing, blessing_type, other_label, person, attendee_user,
  branch, zone, bsc, session, event, sunday_service, service_date,
  recorded_by, notes)
  ON blessing_recipients TO directus_app;

REVOKE ALL ON blessing_recipients FROM PUBLIC;
