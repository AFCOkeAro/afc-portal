-- tests/db/71_attendance_counts.sql
--
-- AFC-468 / AFC-461c. THE ATTENDANCE SPLIT CONTRACT.
--
-- The routes (/api/attendance/report, /api/attendance/report.csv, capture) are
-- only as honest as the rows they read, so this suite asserts the database
-- half of the US-A1..A4 promise -- the half a crafted HTTP request cannot
-- change:
--
--   71.1  seed          -- eleven service_type_definitions (§3.1 key set);
--                         every category key in every definition is a legal
--                         attendance_counts category (the capture form can only
--                         offer what the child table can store); the
--                         sunday_school set is exactly the spec example, order
--                         included (the form renders it in order).
--   71.2  rerun         -- re-applying 20261020_0003 changes nothing
--                         (ON CONFLICT DO NOTHING on key; counts identical).
--   71.3  backfill      -- legacy headcount_adults/youth/teens/children/
--                         visitors map to category rows with sex = unspecified
--                         (historical rows stay valid, shown as unsplit);
--                         NULL/zero headcounts map to nothing; men/women are
--                         NOT mapped (already a sex split, no category to
--                         attribute -- inventing one would corrupt the report).
--   71.4  constraints   -- duplicate (session,category,sex) rejected; count < 0
--                         rejected; unknown category/sex rejected; category =
--                         other without a label rejected (blank counts too).
--   71.5  idempotent    -- replaying a capture batch (INSERT .. ON CONFLICT
--                         DO UPDATE) leaves one row with the latest count;
--                         replaying a session idempotency_key is refused.
--   71.6  reconcile     -- male + female rows sum to the session total the
--                         attendance.total Flow must write (SUM(count)).
--   71.7  guards        -- the app identity reads both tables, writes counts
--                         and operational definition columns, and deletes
--                         nothing; `key` is insertable but never updatable.
--   71.8  report-ready  -- the (session,category,sex) unique index and the
--                         session/category indexes exist; branch/zone/date/
--                         service_type predicates partition fixture rows the
--                         way the report and CSV queries filter them (the DB
--                         half of "CSV row-equality with the query").
--
-- FIXTURE, STATED PLAINLY. Retired as a stand-in, kept as rows (AFC-566):
-- 20261020_0023 created the real attendance_sessions register, so the
-- tripwire below now pins the opposite -- the table MUST exist with the
-- owning slice's shape (route columns 0003 would never create) -- and the
-- legacy fixtures insert into the real table instead of a fork. 71.2
-- re-applies 0003 so the REAL backfill block fires against the real table
-- (not a copy), and 71.9 deletes only the three fixture rows (fixed ids,
-- ON CONFLICT-safe), leaving the register standing for suites 77/78/88.
-- Fixture session ids are fixed uuids and every probe write is
-- ON CONFLICT-safe, so this file reruns cleanly in one database.
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a branch admin's cross-branch report rejected, a branch export
-- containing only its own branch, CSV streaming/chunking -- lives in the
-- route layer (getPortalScope + scopeFilter) and is covered there. A SQL
-- suite asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 71.0  FIXTURE. Tripwire retired: the real table must exist with the
--        owning slice's shape (route columns + legacy headcounts +
--        idempotency UNIQUE). Fixtures insert into the real register.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'session_type')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'headcount_adults')
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attendance_sessions_idempotency_key_key'),
    'attendance', 'real attendance_sessions present with the 0023 shape: the backfill below runs against the register, not a stand-in');
END $$;

-- Probe rows use fixed session ids so a rerun collides into the same rows.
-- (AFC-566: fixture-era `service_type` renamed to the route-canonical
-- `session_type` with the 0023 register; values unchanged, all 11-key.)
INSERT INTO attendance_sessions
  (id, branch, zone, session_type, session_date, session_name,
   headcount_men, headcount_women, headcount_children, headcount_youth,
   headcount_adults, headcount_teens, headcount_visitors, headcount_total,
   idempotency_key)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'),
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
   'sunday_service', DATE '2026-10-04', 'Sunday Service',
   90, 110, 60, 40, 100, 30, 12, 442, 'capture-a1'),
  ('22222222-2222-2222-2222-222222222222',
   (SELECT id FROM branches WHERE code = 'LEGUN'),
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'),
   'midweek', DATE '2026-10-07', 'Midweek Word',
   NULL, NULL, NULL, NULL, 45, NULL, 3, 48, 'capture-b1'),
  ('33333333-3333-3333-3333-333333333333',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'),
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
   'youth_service', DATE '2026-09-12', 'Youth Service (split capture)',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'capture-c1')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 71.1  SEED SHAPE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions) = 11,
    'attendance', 'eleven seeded service types');

  PERFORM test_support.assert_equals(
    (SELECT string_agg(key, ',' ORDER BY key) FROM service_type_definitions),
    'camp,department,devotional,elementary,event,midweek,revival_service,special,sunday_school,sunday_service,youth_service',
    'attendance', 'the seeded key set is exactly the §3.1 list');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions WHERE status <> 'active') = 0,
    'attendance', 'every seeded definition is active');

  -- The category set matches the child table: no definition may offer a
  -- category the counts table cannot store.
  -- AFC-835 (migration 0048): ministers + altar workers left the
  -- definitions; secretaries + senior_friends + spillover joined.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions d,
       LATERAL jsonb_array_elements_text(d.categories) c
     WHERE c NOT IN ('children','teens','adults','youth','teachers',
                     'secretaries','senior_friends','spillover',
                     'avs','visitors','other')) = 0,
    'attendance', 'every configured category is a legal counts category');

  -- The spec example, order included: the form renders this array in order.
  -- AFC-835: the spec example grew the three new keys (order kept).
  PERFORM test_support.assert_equals(
    (SELECT categories::text FROM service_type_definitions WHERE key = 'sunday_school'),
    '["children", "teens", "adults", "teachers", "secretaries", "senior_friends", "spillover"]',
    'attendance', 'sunday_school offers exactly the spec example set in order');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions WHERE requires_bsc) = 0,
    'attendance', 'no seed row claims requires_bsc (board policy, not seed data)');
END $$;

-- ---------------------------------------------------------------------------
-- 71.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0003_attendance_counts.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM service_type_definitions) = 11,
    'attendance', 'rerun: still eleven service types');

  -- The backfill fired during the rerun: session A maps five legacy columns,
  -- session B maps two (the rest are NULL), session C maps none (all NULL).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts
      WHERE session = '11111111-1111-1111-1111-111111111111') = 5,
    'attendance', 'rerun: full legacy session maps to five unsplit rows');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts
      WHERE session = '22222222-2222-2222-2222-222222222222') = 2,
    'attendance', 'rerun: partial legacy session maps only its present columns');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts
      WHERE session = '33333333-3333-3333-3333-333333333333'
        AND sex = 'unspecified') = 0,
    'attendance', 'rerun: all-NULL legacy session maps to nothing');
END $$;

-- ---------------------------------------------------------------------------
-- 71.3  BACKFILL VALUES. Mapped counts equal the legacy columns; everything
--        is sex = unspecified; men/women are not mapped anywhere.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT string_agg(category || '=' || count::text, ',' ORDER BY category)
       FROM attendance_counts
      WHERE session = '11111111-1111-1111-1111-111111111111'),
    'adults=100,children=60,teens=30,visitors=12,youth=40',
    'attendance', 'backfilled counts equal the legacy columns');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts
      WHERE session = '11111111-1111-1111-1111-111111111111'
        AND sex <> 'unspecified') = 0,
    'attendance', 'historical rows stay valid as unsplit (sex = unspecified)');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(sum(count), 0)::text FROM attendance_counts
      WHERE session = '11111111-1111-1111-1111-111111111111'),
    '242',
    'attendance', 'split rows reconcile (100+40+30+60+12 = 242)');

  -- A second rerun inserts nothing: the backfill is idempotent.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts) = 7,
    'attendance', 'backfill total is stable (5 + 2, no duplicates)');
END $$;

-- ---------------------------------------------------------------------------
-- 71.4  CONSTRAINTS. The checks the capture path relies on.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Duplicate (session, category, sex) is rejected: the retry no-op rests here.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('11111111-1111-1111-1111-111111111111', 'adults', 'unspecified', 100)$q$,
    '23505', 'attendance', 'duplicate (session, category, sex) is rejected');

  -- Negative counts are rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'youth', 'male', -1)$q$,
    '23514', 'attendance', 'a negative count is rejected');

  -- Unknown category / sex rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'elders', 'male', 5)$q$,
    '23514', 'attendance', 'an unknown category is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'youth', 'other', 5)$q$,
    '23514', 'attendance', 'an unknown sex is rejected');

  -- category = other requires a label: NULL, empty and blank all fail.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'other', 'male', 5)$q$,
    '23514', 'attendance', 'other without a label is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, category_other_label, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'other', '   ', 'male', 5)$q$,
    '23514', 'attendance', 'other with a blank label is rejected');

  -- A session is required.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES (NULL, 'youth', 'male', 5)$q$,
    '23502', 'attendance', 'a count without a session is rejected');

  -- Positive cases the constraints must allow: labelled other, zero counts.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (id, session, category, category_other_label, sex, count) VALUES ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', '33333333-3333-3333-3333-333333333333', 'other', 'Deaf fellowship', 'female', 4) ON CONFLICT (id) DO NOTHING$q$,
    'attendance', 'other with a label is accepted');
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO attendance_counts (id, session, category, sex, count) VALUES ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', '33333333-3333-3333-3333-333333333333', 'youth', 'male', 0) ON CONFLICT (id) DO NOTHING$q$,
    'attendance', 'a zero count is accepted (a category with nobody present is data)');
END $$;

-- Probe writes roll back (probe undoes its own statements), so the accepted
-- other-label row is inserted again here, persistently, for the reconcile and
-- report sections below to read. ON CONFLICT keeps this file rerunnable.
INSERT INTO attendance_counts (id, session, category, category_other_label, sex, count) VALUES
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', '33333333-3333-3333-3333-333333333333',
   'other', 'Deaf fellowship', 'female', 4)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 71.5  IDEMPOTENT RETRY. A replayed batch upserts; a replayed session key
--        collides instead of duplicating.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    ('33333333-3333-3333-3333-333333333333', 'youth', 'male', 18),
    ('33333333-3333-3333-3333-333333333333', 'youth', 'female', 22)
  ON CONFLICT (session, category, sex) DO UPDATE SET count = EXCLUDED.count;

  -- The retry: same batch, corrected youth/male figure.
  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    ('33333333-3333-3333-3333-333333333333', 'youth', 'male', 19),
    ('33333333-3333-3333-3333-333333333333', 'youth', 'female', 22)
  ON CONFLICT (session, category, sex) DO UPDATE SET count = EXCLUDED.count;

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_counts
      WHERE session = '33333333-3333-3333-3333-333333333333'
        AND category = 'youth') = 2,
    'attendance', 'a replayed batch leaves one row per (category, sex)');

  PERFORM test_support.assert_equals(
    (SELECT count::text FROM attendance_counts
      WHERE session = '33333333-3333-3333-3333-333333333333'
        AND category = 'youth' AND sex = 'male'),
    '19',
    'attendance', 'a replayed batch keeps the latest figure');

  -- The session-level key turns a double submit into a refusal, not a twin.
  -- Probed as the table owner (AFC-566: the retired fixture was session-
  -- owned, so the probe used the NULL role; the real register is
  -- migrator-owned with no app DELETE, and the owner hits the UNIQUE
  -- directly instead of a grant refusal).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO attendance_sessions (branch, session_type, session_date, idempotency_key) VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), 'sunday_service', DATE '2026-10-11', 'capture-a1')$q$,
    '23505', 'attendance', 'replaying a session idempotency_key is refused');
END $$;

-- ---------------------------------------------------------------------------
-- 71.6  RECONCILE. Male + female rows sum to the total the attendance.total
--        Flow must write into the session header.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    ('33333333-3333-3333-3333-333333333333', 'teens', 'male', 9),
    ('33333333-3333-3333-3333-333333333333', 'teens', 'female', 11),
    ('33333333-3333-3333-3333-333333333333', 'secretaries', 'male', 3),
    ('33333333-3333-3333-3333-333333333333', 'secretaries', 'female', 2)
  ON CONFLICT (session, category, sex) DO UPDATE SET count = EXCLUDED.count;

  PERFORM test_support.assert_equals(
    (SELECT coalesce(sum(count), 0)::text FROM attendance_counts
      WHERE session = '33333333-3333-3333-3333-333333333333'
        AND sex IN ('male', 'female')),
    '70',
    'attendance', 'male + female reconcile (19+22 youth, 9+11 teens, 3+2 secretaries, 4 labelled-other)');
END $$;

-- ---------------------------------------------------------------------------
-- 71.7  GUARDS. Uniqueness is enforced; the app ceiling holds.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM attendance_counts$q$,
    'attendance', 'directus_app can read counts');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM service_type_definitions$q$,
    'attendance', 'directus_app can read definitions');

  -- The app never writes `id` (it defaults); the grant list matches that, so
  -- the probe inserts exactly the columns the app may write.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO attendance_counts (session, category, sex, count) VALUES ('33333333-3333-3333-3333-333333333333', 'visitors', 'male', 6) ON CONFLICT (session, category, sex) DO NOTHING$q$,
    'attendance', 'directus_app can insert counts');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE attendance_counts SET count = 6 WHERE session = '33333333-3333-3333-3333-333333333333' AND category = 'visitors' AND sex = 'male'$q$,
    'attendance', 'directus_app can correct counts');

  -- Board evolution path: new keys insertable, descriptive columns updatable.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO service_type_definitions (key, label, categories) VALUES ('probe_service', 'Probe', '["adults"]') ON CONFLICT (key) DO NOTHING$q$,
    'attendance', 'directus_app can add a service type (board evolution without a migration)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE service_type_definitions SET label = 'Probe' WHERE key = 'probe_service'$q$,
    'attendance', 'directus_app can edit definition labels');

  -- The ceiling: no DELETE anywhere, and `key` is never updatable. (Probe
  -- writes roll back, so these DELETEs target rows the persistent sections
  -- wrote; permission is checked before any row match, hence 42501 either way.)
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM attendance_counts WHERE session = '33333333-3333-3333-3333-333333333333'$q$,
    '42501', 'attendance', 'directus_app has no DELETE on counts');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM service_type_definitions WHERE key = 'probe_service'$q$,
    '42501', 'attendance', 'directus_app has no DELETE on definitions');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE service_type_definitions SET key = 'renamed' WHERE key = 'probe_service'$q$,
    '42501', 'attendance', 'directus_app cannot rename a definition key');
END $$;

-- ---------------------------------------------------------------------------
-- 71.8  REPORT-READY. Indexes exist; the filter predicates partition rows the
--        way the report and CSV queries filter them (branch/zone, session
--        type, date range). The CSV streams this same filtered aggregate; its
--        chunking and the HTTP permission scope live in the route layer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid; v_z2 uuid;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'attendance_counts_session_category_sex_unique'),
    'attendance', 'the (session, category, sex) unique constraint exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'attendance_counts_session_idx'),
    'attendance', 'the session index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'attendance_counts_category_idx'),
    'attendance', 'the category index exists');

  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';
  SELECT id INTO v_z2 FROM zones WHERE code = 'LAG-NORTH-Z2';

  -- Branch predicate: Oke-Aro sessions only (two of three fixtures).
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM attendance_sessions s
      WHERE s.branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    '2',
    'attendance', 'a branch predicate returns exactly that branch''s sessions');

  -- Zone predicate: Z1 vs Z2 are disjoint, and every fixture is in one of them.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM attendance_sessions WHERE zone = v_z1),
    '2',
    'attendance', 'a Z1 predicate returns exactly Z1''s sessions');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM attendance_sessions WHERE zone = v_z2),
    '1',
    'attendance', 'a Z2 predicate returns exactly Z2''s session');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_sessions WHERE zone = v_z1 AND zone = v_z2) = 0,
    'attendance', 'zone predicates are disjoint');

  -- Date + type predicates: October sunday_service is exactly session A.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM attendance_sessions
      WHERE session_date >= DATE '2026-10-01' AND session_date <= DATE '2026-10-31'
        AND session_type = 'sunday_service'),
    '1',
    'attendance', 'a date-range + session-type predicate isolates one session');

  -- The joined aggregate the report groups by: branch x category x sex.
  PERFORM test_support.assert_equals(
    (SELECT coalesce(sum(c.count), 0)::text
       FROM attendance_counts c JOIN attendance_sessions s ON s.id = c.session
      WHERE s.zone = v_z1 AND c.sex = 'unspecified'),
    '242',
    'attendance', 'the zone x sex aggregate matches the backfilled total');
END $$;

-- ---------------------------------------------------------------------------
-- 71.9  TEARDOWN. The three fixture rows go (their counts cascade with
--        them); the real register stays for suites 77/78/88.
-- ---------------------------------------------------------------------------
DELETE FROM attendance_sessions WHERE id IN
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333');

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_sessions WHERE id IN
      ('11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222',
       '33333333-3333-3333-3333-333333333333')) = 0,
    'attendance', 'the fixture rows are gone (their backfilled counts cascaded with them)');
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL,
    'attendance', 'the real register stands: 0023 owns it, not this suite');
END $$;
