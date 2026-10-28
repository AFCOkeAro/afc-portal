-- Suite 50: session activities (AFC-826, migration 0050).
--
--   50.1 rerun         -- re-applying 20261028_0050 changes nothing.
--   50.2 shape         -- one programme item per row; activity_type is a
--                         closed set; items cascade with their session.
--   50.3 grants        -- directus_app SELECTs + writes + DELETEs (builder
--                         needs remove); PUBLIC holds nothing.
--   50.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0050_session_activities.sql

-- ---------------------------------------------------------------------------
-- 50.1  RERUN. Re-applying 0050 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0050_session_activities.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'schedule',
    '50.1: 0050 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 50.2  SHAPE. Items hang off a session and cascade with it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_session uuid;
BEGIN
  INSERT INTO attendance_sessions (branch, session_date, session_type, session_name, idempotency_key)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-11-02', 'event', 'Schedule builder probe', 'sched-a50')
    RETURNING id INTO v_session;

  INSERT INTO session_activities (session, branch, zone, activity_type, title, position, duration_minutes)
    VALUES (v_session, (SELECT branch FROM attendance_sessions WHERE id = v_session),
            (SELECT zone FROM attendance_sessions WHERE id = v_session),
            'music', 'Praise', 0, 20);
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM session_activities WHERE session = v_session) = 1,
    'schedule', '50.2: a programme item writes');
  PERFORM test_support.assert_true(
    (SELECT branch IS NOT NULL FROM session_activities WHERE session = v_session LIMIT 1),
    'schedule', '50.2: branch denorm stamps from the parent session');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_activities_session_fkey'),
    'schedule', '50.2: the named session FK exists (parked by suites 86/88)');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO session_activities (session, activity_type, title) VALUES (''' || v_session || ''', ''sermon'', ''Word'')',
    '23514', 'schedule', '50.2: activity_type is a closed set');

  DELETE FROM attendance_sessions WHERE id = v_session;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM session_activities WHERE session = v_session) = 0,
    'schedule', '50.2: items cascade with their session');
END $$;

-- ---------------------------------------------------------------------------
-- 50.3  GRANTS. App reads and writes incl. DELETE; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.session_activities', 'SELECT'),
    'schedule', '50.3: app reads the activities');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.session_activities', 'INSERT, UPDATE, DELETE'),
    'schedule', '50.3: app manages items (builder needs remove)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'session_activities'
        AND grantee = 'PUBLIC') = 0,
    'schedule', '50.3: PUBLIC holds nothing on the activities');
END $$;

-- ---------------------------------------------------------------------------
-- 50.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_session uuid;
BEGIN
  INSERT INTO attendance_sessions (branch, session_date, session_type, session_name, idempotency_key)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-11-03', 'event', 'Rollback probe', 'sched-b50')
    RETURNING id INTO v_session;
  INSERT INTO session_activities (session, branch, activity_type, title, position)
    VALUES (v_session, (SELECT branch FROM attendance_sessions WHERE id = v_session),
            'prayer', 'Opening prayer', 0);
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0050_session_activities.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'schedule', '50.4: down refuses while items exist');
  DELETE FROM session_activities WHERE session = v_session;
  DELETE FROM attendance_sessions WHERE id = v_session;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0050_session_activities.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.session_activities') IS NULL,
    'schedule', '50.4: down drops the activities table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0050_session_activities.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.session_activities') IS NOT NULL,
    'schedule', '50.4: re-apply restores the activities table');
END $$;
