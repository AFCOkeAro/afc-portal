-- rollback/20261028_0048_attendance_categories.down.sql
--
-- Reversal for 20261028_0048_attendance_categories.sql (AFC-835).
--
-- What it destroys, stated plainly: nothing but the category lists --
-- the exact 0003 seed arrays are restored verbatim. No rows, no grants,
-- no tables change.
--
-- Where service_type_definitions is absent (forward never applied) the
-- script is a no-op with a NOTICE.

DO $$
BEGIN
  IF to_regclass('public.service_type_definitions') IS NULL THEN
    RAISE NOTICE 'service_type_definitions absent; nothing to restore.';
  ELSE

  UPDATE service_type_definitions SET categories =
    '["children", "teens", "adults", "teachers"]' WHERE key = 'sunday_school';
  UPDATE service_type_definitions SET categories =
    '["children", "teachers"]' WHERE key = 'elementary';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "ministers"]' WHERE key = 'devotional';
  UPDATE service_type_definitions SET categories =
    '["youth", "teens", "ministers"]' WHERE key = 'youth_service';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "teens", "children", "ministers", "altar_workers", "visitors"]' WHERE key = 'revival_service';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "teens", "children", "ministers", "altar_workers", "avs", "visitors", "other"]' WHERE key = 'sunday_service';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "ministers", "visitors"]' WHERE key = 'midweek';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "teens", "children", "visitors", "other"]' WHERE key = 'event';
  UPDATE service_type_definitions SET categories =
    '["children", "teens", "youth", "adults", "teachers", "ministers", "altar_workers", "visitors"]' WHERE key = 'camp';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "ministers", "visitors"]' WHERE key = 'department';
  UPDATE service_type_definitions SET categories =
    '["adults", "youth", "teens", "children", "teachers", "ministers", "altar_workers", "avs", "visitors", "other"]' WHERE key = 'special';

  RAISE NOTICE 'service_type_definitions restored to the 0003 seed arrays.';
  END IF;

  IF to_regclass('public.attendance_counts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_category_check') THEN
    ALTER TABLE attendance_counts DROP CONSTRAINT attendance_counts_category_check;
    ALTER TABLE attendance_counts ADD CONSTRAINT attendance_counts_category_check
      CHECK (category IN
        ('children', 'teens', 'adults', 'youth', 'teachers',
         'ministers', 'altar_workers', 'avs', 'visitors', 'other'));
    RAISE NOTICE 'CHECK attendance_counts_category_check restored to the ten-way set.';
  END IF;
END
$$;
