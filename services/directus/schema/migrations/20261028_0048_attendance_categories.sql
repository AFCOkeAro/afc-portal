-- Migration 0048: headcount category set (AFC-835, chairman direction
-- 2026-10-27: defaults Adult/Youth/Children/Visitors, add-more rows from
-- AVS/Secretaries/Senior Friends/Spillover; ministers + altar workers out).
--
-- Rewrites the categories arrays on all eleven service_type_definitions
-- seed rows: drops ministers + altar_workers everywhere, adds secretaries,
-- senior_friends and spillover everywhere (avs/secretaries-family keys
-- were already present on some rows). Order is display order: existing
-- entries keep their relative positions, added keys append before a
-- trailing 'other' where one exists. The portal headcount forms render the
-- definition order, default-selecting adults/youth/children/visitors and
-- offering the rest through an add-row picker (app slice, same packet).
--
-- No grants change: directus_app already reads the register. No roles
-- provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-835). R2 CTO review on
-- the AFC-835 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0048_attendance_categories.down.sql
-- (restores the exact 0003 arrays). Owner: migration role
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
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). The definitions register
--    must already belong to directus_migrator: only an owner may UPDATE it.
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
         AND c.relname IN ('service_type_definitions')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the headcount category set: % is not owned by '
      'directus_migrator, and only an owner may UPDATE it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The counts table CHECK. attendance_counts carries the same ten-way
--    list inline (0003). It becomes the eleven-way list to match the
--    evolved ATTENDANCE_CATEGORIES; without this, inserts of the new keys
--    fail at the table (suite 71 proves it).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.attendance_counts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_category_check') THEN
    ALTER TABLE attendance_counts DROP CONSTRAINT attendance_counts_category_check;
  END IF;
  IF to_regclass('public.attendance_counts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_category_check') THEN
    ALTER TABLE attendance_counts ADD CONSTRAINT attendance_counts_category_check
      CHECK (category IN
        ('children', 'teens', 'adults', 'youth', 'teachers', 'avs',
         'secretaries', 'senior_friends', 'spillover', 'visitors', 'other'));
    RAISE NOTICE 'CHECK attendance_counts_category_check evolved to the eleven-way set.';
  ELSE
    RAISE NOTICE 'attendance_counts absent; CHECK evolution skipped.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Category sets. Every row drops ministers + altar_workers and gains
--    secretaries + senior_friends + spillover; all other entries keep
--    their relative order.
-- ---------------------------------------------------------------------------
UPDATE service_type_definitions SET categories =
  '["children", "teens", "adults", "teachers", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'sunday_school';
UPDATE service_type_definitions SET categories =
  '["children", "teachers", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'elementary';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'devotional';
UPDATE service_type_definitions SET categories =
  '["youth", "teens", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'youth_service';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "teens", "children", "visitors", "avs", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'revival_service';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "teens", "children", "visitors", "avs", "secretaries", "senior_friends", "spillover", "other"]'
  WHERE key = 'sunday_service';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "visitors", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'midweek';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "teens", "children", "visitors", "secretaries", "senior_friends", "spillover", "other"]'
  WHERE key = 'event';
UPDATE service_type_definitions SET categories =
  '["children", "teens", "youth", "adults", "teachers", "visitors", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'camp';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "visitors", "secretaries", "senior_friends", "spillover"]'
  WHERE key = 'department';
UPDATE service_type_definitions SET categories =
  '["adults", "youth", "teens", "children", "teachers", "visitors", "avs", "secretaries", "senior_friends", "spillover", "other"]'
  WHERE key = 'special';
