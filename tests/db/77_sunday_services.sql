-- tests/db/77_sunday_services.sql
--
-- AFC-473 / AFC-463b. THE SUNDAY SERVICES + ROSTER CONTRACT.
--
-- The routes (/api/services, /api/services/:id/assignments) enforce
-- branch/zone isolation with Directus filters over denorm columns (portal.ts
-- scope helpers) plus a department-head membership check over
-- people_departments. A filter is only as honest as the columns it reads, so
-- this suite asserts the database half of that promise -- the half a crafted
-- HTTP request cannot change:
--
--   77.1  tables        -- sunday_services, service_assignments and
--                         sunday_service_events exist with the §4.3/§4.4
--                         shapes; headcount_* on attendance_sessions is
--                         untouched (back-compat, per issue).
--   77.2  rerun         -- re-applying 20261020_0010 changes nothing
--                         (IF NOT EXISTS everywhere; counts identical).
--   77.3  constraints   -- a service requires a branch; unknown
--                         service_type/role/status rejected; negative
--                         expected/total attendance rejected; an assignment
--                         requires a service and a person; deleting a
--                         rostered person is refused (RESTRICT); deleting a
--                         service removes its roster and trail (CASCADE).
--   77.4  denorm        -- service zone backfills from its branch's zone;
--                         assignment branch backfills from its service;
--                         attendance_sessions is absent from the scratch DB,
--                         so the denorm columns are skipped loudly rather
--                         than forking a table another slice owns.
--   77.5  guards        -- the app identity reads all three tables, writes
--                         operational columns, and deletes nothing (services
--                         are audited ministry facts; the events table is the
--                         trail; erasure runs as retention_worker).
--   77.6  indexes       -- the §4.3/§4.4 index set exists; branch and zone
--                         predicates partition fixture rows the way the list
--                         route filters them.
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a zone admin's cross-zone service rejected, a branch export
-- containing only its own branch, a department head rostering another
-- department's member refused -- lives in the route layer
-- (requireZoneInScope + requireDeptScopeForPerson) and is covered there. A
-- SQL suite asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 77.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
-- ---------------------------------------------------------------------------
INSERT INTO people (id, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sunday_services
  (id, branch, service_date, service_time, service_type, theme, status)
VALUES
  ('11111111-1111-4111-8111-111111111111',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    DATE '2026-10-04', TIME '09:00', 'sunday', 'Grace for the journey', 'completed'),
  ('22222222-2222-4222-8222-222222222222',
    (SELECT id FROM branches WHERE code = 'LEGUN'),
    DATE '2026-10-04', TIME '09:00', 'sunday', 'Faithful in little', 'planned')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_assignments
  (id, service, person, role, status)
VALUES
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'usher', 'confirmed')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 77.1  TABLES. The three tables exist; the session header the denorm
--        targets does not (another slice owns it).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.sunday_services') IS NOT NULL,
    'services', 'sunday_services exists');
  PERFORM test_support.assert_true(
    to_regclass('public.service_assignments') IS NOT NULL,
    'services', 'service_assignments exists');
  PERFORM test_support.assert_true(
    to_regclass('public.sunday_service_events') IS NOT NULL,
    'services', 'sunday_service_events exists');
  -- AFC-566: attendance_sessions is no longer absent -- 20261020_0023
  -- created the register, so the 0010 conditional blocks (zone/bsc/
  -- service_type_def denorms + attendance_counts_session_fkey) land for
  -- real on re-apply instead of skipping loudly. Pinned positively: the
  -- sessions register exists with the denorm columns 0010 would have
  -- added, proving 0010 met a real table, never a fork.
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'zone')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'service_type_def'),
    'services', 'attendance_sessions is 0023-owned: 0010 denorms land, not forked');
END $$;

-- ---------------------------------------------------------------------------
-- 77.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0010_sunday_services.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM sunday_services
      WHERE id IN ('11111111-1111-4111-8111-111111111111',
                   '22222222-2222-4222-8222-222222222222')) = 2,
    'services', 'rerun: both fixture services survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_assignments
      WHERE id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1') = 1,
    'services', 'rerun: the fixture assignment survives');
END $$;

-- ---------------------------------------------------------------------------
-- 77.3  CONSTRAINTS. The checks the roster path relies on.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A service requires a branch: a scopeless service would be invisible.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO sunday_services (branch, service_date) VALUES (NULL, DATE '2026-10-11')$q$,
    '23502', 'services', 'a service without a branch is rejected');

  -- Unknown service_type / role / status rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO sunday_services (branch, service_date, service_type) VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11', 'easter_play')$q$,
    '23514', 'services', 'an unknown service_type is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO service_assignments (service, person, role) VALUES ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'drummer')$q$,
    '23514', 'services', 'an unknown roster role is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO service_assignments (service, person, role, status) VALUES ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'usher', 'maybe')$q$,
    '23514', 'services', 'an unknown assignment status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO sunday_service_events (service, event_type) VALUES ('11111111-1111-4111-8111-111111111111', 'deleted')$q$,
    '23514', 'services', 'an unknown audit event type is rejected');

  -- Negative attendance figures rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO sunday_services (branch, service_date, expected_attendance) VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11', -5)$q$,
    '23514', 'services', 'a negative expected attendance is rejected');

  -- An assignment requires a service and a person.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO service_assignments (service, person, role) VALUES (NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'usher')$q$,
    '23502', 'services', 'an assignment without a service is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO service_assignments (service, person, role) VALUES ('11111111-1111-4111-8111-111111111111', NULL, 'usher')$q$,
    '23502', 'services', 'an assignment without a person is rejected');

  -- person RESTRICT: a rostered person is not deleted by accident.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM people WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$,
    '23503', 'services', 'deleting a rostered person is refused (RESTRICT)');

  -- Positive cases the constraints must allow.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO sunday_service_events (id, service, event_type, detail) VALUES ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', '11111111-1111-4111-8111-111111111111', 'note', 'Sound check at 08:00') ON CONFLICT (id) DO NOTHING$q$,
    'services', 'a freeform audit note is accepted');
END $$;

-- service CASCADE: deleting a service removes its roster and trail. Probed
-- on a throwaway service so the fixtures survive. Probe writes roll back
-- (assert.sql), so the throwaway rows are plain persistent INSERTs --
-- ON CONFLICT keeps this file rerunnable -- and only the DELETE + counts
-- are assertions.
INSERT INTO sunday_services (id, branch, service_date)
  VALUES ('99999999-9999-4999-8999-999999999999',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO service_assignments (id, service, person, role)
  VALUES ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a',
    '99999999-9999-4999-8999-999999999999',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'media')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO sunday_service_events (id, service, event_type)
  VALUES ('7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b',
    '99999999-9999-4999-8999-999999999999', 'created')
  ON CONFLICT (id) DO NOTHING;

-- The DELETE is a plain statement, not a probe: probes roll back, and the
-- counts below must observe the CASCADE. The top-of-file INSERTs restore
-- the throwaway rows on rerun (ON CONFLICT), so this stays rerunnable.
DELETE FROM sunday_services WHERE id = '99999999-9999-4999-8999-999999999999';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM sunday_services WHERE id = '99999999-9999-4999-8999-999999999999') = 0,
    'services', 'the throwaway service is gone (migrator delete)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_assignments WHERE service = '99999999-9999-4999-8999-999999999999') = 0,
    'services', 'the roster follows its service (CASCADE)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM sunday_service_events WHERE service = '99999999-9999-4999-8999-999999999999') = 0,
    'services', 'the trail follows its service (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 77.4  DENORM. Zone backfills from the branch; assignment branch backfills
--        from the service; the absent sessions table stays absent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM sunday_services WHERE id = '11111111-1111-4111-8111-111111111111'),
    (SELECT zone::text FROM branches WHERE code = 'OKE-ARO'),
    'services', 'service zone agrees with its branch zone');
  PERFORM test_support.assert_equals(
    (SELECT branch::text FROM service_assignments WHERE id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
    (SELECT branch::text FROM sunday_services WHERE id = '11111111-1111-4111-8111-111111111111'),
    'services', 'assignment branch agrees with its service branch');
  -- AFC-566: the sessions table is no longer absent (see 77.1) -- the
  -- re-applied 0010 lands its denorms on the real 0023 register, and the
  -- back-compat headcount columns stay exactly as 0023 created them (the
  -- owning slice's shape, not a 0010 fork).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
               AND column_name IN ('headcount_total', 'headcount_men',
                 'headcount_women', 'headcount_children')),
    'services', 'headcount columns ride the 0023 register (back-compat, untouched by 0010)');
END $$;

-- ---------------------------------------------------------------------------
-- 77.5  GUARDS. The app ceiling: read everywhere, write operational
--        columns, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM sunday_services$q$,
    'services', 'directus_app can read services');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM service_assignments$q$,
    'services', 'directus_app can read assignments');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM sunday_service_events$q$,
    'services', 'directus_app can read the audit trail');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO sunday_services (branch, service_date, service_time, service_type) VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-18', TIME '09:00', 'sunday')$q$,
    'services', 'directus_app can plan services');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE sunday_services SET status = 'planned' WHERE id = '22222222-2222-4222-8222-222222222222'$q$,
    'services', 'directus_app can update services');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO service_assignments (service, person, role) VALUES ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'usher') ON CONFLICT DO NOTHING$q$,
    'services', 'directus_app can roster');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE service_assignments SET status = 'confirmed' WHERE id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$q$,
    'services', 'directus_app can move roster status');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO sunday_service_events (service, event_type, detail) VALUES ('11111111-1111-4111-8111-111111111111', 'note', 'probe')$q$,
    'services', 'directus_app can write audit rows');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM sunday_services WHERE id = '11111111-1111-4111-8111-111111111111'$q$,
    '42501', 'services', 'directus_app has no DELETE on services');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM service_assignments WHERE id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$q$,
    '42501', 'services', 'directus_app has no DELETE on assignments');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM sunday_service_events WHERE service = '11111111-1111-4111-8111-111111111111'$q$,
    '42501', 'services', 'directus_app has no DELETE on the audit trail');
END $$;

-- ---------------------------------------------------------------------------
-- 77.6  INDEXES + PARTITION. The §4.3/§4.4 index set exists; branch and
--        zone predicates partition fixture rows the way the list route
--        filters them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sunday_services_branch_date_time_idx'),
    'services', 'the (branch, service_date, service_time) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sunday_services_status_idx'),
    'services', 'the service status index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'service_assignments_service_role_idx'),
    'services', 'the (service, role) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sunday_service_events_service_created_idx'),
    'services', 'the (service, created_at) audit index exists');

  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';

  -- Branch predicate: Oke-Aro services only (one of two fixtures).
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM sunday_services s
      WHERE s.branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    '1',
    'services', 'a branch predicate returns exactly that branch''s service');

  -- Zone predicate: Z1 vs the rest are disjoint.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM sunday_services WHERE zone = v_z1),
    '1',
    'services', 'a Z1 predicate returns exactly Z1''s service');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM sunday_services WHERE zone IS DISTINCT FROM v_z1),
    '1',
    'services', 'the non-Z1 service is exactly the other fixture');

  -- Status predicate: one planned, one completed.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM sunday_services WHERE status = 'planned'),
    '1',
    'services', 'a status predicate isolates the planned service');
END $$;
