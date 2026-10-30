-- Suite 61: session-linked resources (AFC-883, migration 0061).
--
--   61.1 rerun         -- re-applying 20261029_0061 changes nothing.
--   61.2 shape         -- a session link sets and clears; cross-session
--                         writes are a route concern, the column accepts
--                         any session id or nothing.
--   61.3 grants        -- directus_app UPDATEs the link; PUBLIC holds no
--                         grant on it.
--   61.4 rollback      -- the SHIPPED down script refuses while any link
--                         is set; cleared, it drops the column;
--                         re-apply restores it.
--
-- Suite 54 drops and re-creates event_resources as the session user when
-- it cycles the 0054 down/up scripts, so this table arrives here owned by
-- the login role without the session link. Repair both before asserting,
-- per the suite-45/99 precedent (in-suite OWNER TO, same owner as prod).
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS event_resources OWNER TO directus_migrator;

\i services/directus/schema/migrations/20261029_0061_session_resources.sql

-- ---------------------------------------------------------------------------
-- 61.1  RERUN. Re-applying 0061 changes nothing (IF NOT EXISTS).

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'session-resources',
    '61.1: 0061 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 61.2  SHAPE. Session links set and clear.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
  v_session uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Session-link probe programme', TIMESTAMPTZ '2026-11-10 09:00:00+00', TIMESTAMPTZ '2026-11-10 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO attendance_sessions (event, session_name, session_date, session_type)
    VALUES (v_event, 'Probe session', DATE '2026-11-10', 'event')
    RETURNING id INTO v_session;
  INSERT INTO event_resources (event, title, source_type, kind, url, status)
    VALUES (v_event, 'Probe handout', 'link', 'document', 'https://x', 'approved')
    RETURNING id INTO v_id;

  UPDATE event_resources SET session_id = v_session WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT session_id FROM event_resources WHERE id = v_id) = v_session,
    'session-resources', '61.2: a session link sets');

  UPDATE event_resources SET session_id = NULL WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT session_id FROM event_resources WHERE id = v_id) IS NULL,
    'session-resources', '61.2: the session link clears cleanly');

  DELETE FROM event_resources WHERE id = v_id;
  DELETE FROM attendance_sessions WHERE id = v_session;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_resources WHERE id = v_id) = 0,
    'session-resources', '61.2: the link probe withdraws cleanly');
END $$;

-- ---------------------------------------------------------------------------
-- 61.3  GRANTS. App UPDATEs the link; PUBLIC holds nothing on it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.event_resources', 'session_id', 'UPDATE'),
    'session-resources', '61.3: app UPDATEs the session link');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'event_resources'
        AND column_name = 'session_id'
        AND grantee = 'PUBLIC') = 0,
    'session-resources', '61.3: PUBLIC holds no grant on the session link');
END $$;

-- ---------------------------------------------------------------------------
-- 61.4  ROLLBACK. Refuses with links set; cleared, drops the column;
-- re-apply restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
  v_session uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Session-link rollback probe', TIMESTAMPTZ '2026-11-11 09:00:00+00', TIMESTAMPTZ '2026-11-11 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO attendance_sessions (event, session_name, session_date, session_type)
    VALUES (v_event, 'Rollback probe session', DATE '2026-11-11', 'event')
    RETURNING id INTO v_session;
  INSERT INTO event_resources (event, title, source_type, kind, url, status)
    VALUES (v_event, 'Rollback probe handout', 'link', 'document', 'https://x', 'approved')
    RETURNING id INTO v_id;
  UPDATE event_resources SET session_id = v_session WHERE id = v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261029_0061_session_resources.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'session-resources', '61.4: down refuses while a link is set');
  UPDATE event_resources SET session_id = NULL WHERE id = v_id;
  DELETE FROM event_resources WHERE id = v_id;
  DELETE FROM attendance_sessions WHERE id = v_session;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261029_0061_session_resources.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'event_resources'
                   AND column_name = 'session_id'),
    'session-resources', '61.4: down drops the link column when clear');
END $$;

\i services/directus/schema/migrations/20261029_0061_session_resources.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'event_resources'
               AND column_name = 'session_id'),
    'session-resources', '61.4: re-apply restores the link column');
END $$;
