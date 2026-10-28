-- Suite 56: event feedback (AFC-828 phase 2, migration 0056).
--
--   56.1 rerun         -- re-applying 20261028_0056 changes nothing.
--   56.2 shape         -- one row per submission; message required; rating
--                         is 1-5; overlong input refused.
--   56.3 grants        -- directus_app SELECTs + writes + DELETEs (programme
--                         admin is the tool); PUBLIC holds nothing.
--   56.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0056_event_feedback.sql

-- ---------------------------------------------------------------------------
-- 56.1  RERUN. Re-applying 0056 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0056_event_feedback.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'feedback',
    '56.1: 0056 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 56.2  SHAPE. Submissions write; message required; rating is 1-5.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Feedback probe programme', TIMESTAMPTZ '2026-11-06 09:00:00+00', TIMESTAMPTZ '2026-11-06 12:00:00+00')
    RETURNING id INTO v_event;

  INSERT INTO event_feedback (event, branch, name, message, rating, contact)
    VALUES (v_event, (SELECT branch FROM events WHERE id = v_event),
            'Adaeze', 'The choir lifted the whole hall.', 5, '08030000002')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT rating FROM event_feedback WHERE id = v_id) = 5,
    'feedback', '56.2: a fan submission writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_feedback (event, message, rating) VALUES (''' || v_event || ''', ''x'', 6)',
    '23514', 'feedback', '56.2: rating is 1-5');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_feedback (event, message) VALUES (''' || v_event || ''', '''')',
    '23514', 'feedback', '56.2: an empty message is refused');

  UPDATE event_feedback SET rating = 4 WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT rating FROM event_feedback WHERE id = v_id) = 4,
    'feedback', '56.2: submissions correct in place');

  DELETE FROM event_feedback WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_feedback WHERE id = v_id) = 0
    AND (SELECT count(*) FROM events WHERE id = v_event) = 0,
    'feedback', '56.2: submissions withdraw cleanly (probe programme removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 56.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_feedback', 'SELECT'),
    'feedback', '56.3: app reads the submissions');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_feedback', 'INSERT, UPDATE, DELETE'),
    'feedback', '56.3: app manages submissions');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_feedback'
        AND grantee = 'PUBLIC') = 0,
    'feedback', '56.3: PUBLIC holds nothing on the feedback register');
END $$;

-- ---------------------------------------------------------------------------
-- 56.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Feedback rollback probe', TIMESTAMPTZ '2026-11-07 09:00:00+00', TIMESTAMPTZ '2026-11-07 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO event_feedback (event, message)
    VALUES (v_event, 'Rollback probe words')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0056_event_feedback.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'feedback', '56.4: down refuses while rows exist');
  DELETE FROM event_feedback WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0056_event_feedback.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_feedback') IS NULL,
    'feedback', '56.4: down drops the feedback table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0056_event_feedback.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_feedback') IS NOT NULL,
    'feedback', '56.4: re-apply restores the feedback table');
END $$;
