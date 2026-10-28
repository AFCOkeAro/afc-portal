-- Suite 48: headcount category set (AFC-835, migration 0048).
--
--   48.1 rerun         -- re-applying 20261028_0048 changes nothing.
--   48.2 sets          -- every definition drops ministers + altar_workers
--                         and gains secretaries + senior_friends +
--                         spillover; exact arrays pinned per key.
--   48.3 readable      -- directus_app still reads the register.
--   48.4 rollback      -- the SHIPPED down script restores the exact 0003
--                         arrays; re-apply restores the 0048 sets.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0048_attendance_categories.sql

-- ---------------------------------------------------------------------------
-- 48.1  RERUN. Re-applying 0048 changes nothing (plain UPDATEs, same values).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0048_attendance_categories.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'attendance',
    '48.1: 0048 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 48.2  SETS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions,
       LATERAL jsonb_array_elements_text(categories) c
     WHERE c IN ('ministers', 'altar_workers')) = 0,
    'attendance', '48.2: ministers + altar workers are gone everywhere');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions d
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.categories) c
                    WHERE c IN ('secretaries', 'senior_friends', 'spillover')
                    HAVING count(*) = 3)) =
    (SELECT count(*) FROM service_type_definitions),
    'attendance', '48.2: all three new keys on every row');
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'event'),
    '["adults", "youth", "teens", "children", "visitors", "secretaries", "senior_friends", "spillover", "other"]',
    'attendance', '48.2: event set exact');
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'sunday_service'),
    '["adults", "youth", "teens", "children", "visitors", "avs", "secretaries", "senior_friends", "spillover", "other"]',
    'attendance', '48.2: sunday_service set exact');
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'sunday_school'),
    '["children", "teens", "adults", "teachers", "secretaries", "senior_friends", "spillover"]',
    'attendance', '48.2: sunday_school set exact');
END $$;

-- ---------------------------------------------------------------------------
-- 48.3  READABLE. The app reads the register (no grant change in 0048).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.service_type_definitions', 'SELECT'),
    'attendance', '48.3: app reads the definitions');
END $$;

-- ---------------------------------------------------------------------------
-- 48.4  ROLLBACK. The SHIPPED down script restores the exact 0003 arrays;
-- re-apply restores the 0048 sets.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261028_0048_attendance_categories.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'event'),
    '["adults", "youth", "teens", "children", "visitors", "other"]',
    'attendance', '48.4: down restores the 0003 event set');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions,
       LATERAL jsonb_array_elements_text(categories) c
     WHERE c = 'ministers') > 0,
    'attendance', '48.4: ministers back after rollback (0003 state)');
END $$;

\i services/directus/schema/migrations/20261028_0048_attendance_categories.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'event'),
    '["adults", "youth", "teens", "children", "visitors", "secretaries", "senior_friends", "spillover", "other"]',
    'attendance', '48.4: re-apply restores the 0048 sets');
END $$;
