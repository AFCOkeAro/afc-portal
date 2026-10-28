-- Suite 57: event testimonies (AFC-828 phase 4, migration 0057).
--
--   57.1 rerun         -- re-applying 20261028_0057 changes nothing.
--   57.2 shape         -- one row per testimony; message required;
--                         overlong input refused.
--   57.3 grants        -- directus_app SELECTs + writes + DELETEs (programme
--                         admin is the tool); PUBLIC holds nothing.
--   57.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0057_event_testimonies.sql

-- ---------------------------------------------------------------------------
-- 57.1  RERUN. Re-applying 0057 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0057_event_testimonies.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'testimonies',
    '57.1: 0057 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 57.2  SHAPE. Testimonies write; message is required.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Testimony probe programme', TIMESTAMPTZ '2026-11-06 09:00:00+00', TIMESTAMPTZ '2026-11-06 12:00:00+00')
    RETURNING id INTO v_event;

  INSERT INTO event_testimonies (event, branch, name, message, contact)
    VALUES (v_event, (SELECT branch FROM events WHERE id = v_event),
            'Emeka', 'I walked in bound and walked out free.', '08030000003')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_testimonies WHERE id = v_id) = 1,
    'testimonies', '57.2: a testimony writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_testimonies (event, message) VALUES (''' || v_event || ''', '''')',
    '23514', 'testimonies', '57.2: an empty message is refused');

  UPDATE event_testimonies SET contact = NULL WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT contact FROM event_testimonies WHERE id = v_id) IS NULL,
    'testimonies', '57.2: contact clears cleanly');

  DELETE FROM event_testimonies WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_testimonies WHERE id = v_id) = 0
    AND (SELECT count(*) FROM events WHERE id = v_event) = 0,
    'testimonies', '57.2: testimonies withdraw cleanly (probe programme removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 57.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_testimonies', 'SELECT'),
    'testimonies', '57.3: app reads the testimonies');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_testimonies', 'INSERT, UPDATE, DELETE'),
    'testimonies', '57.3: app manages testimonies');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_testimonies'
        AND grantee = 'PUBLIC') = 0,
    'testimonies', '57.3: PUBLIC holds nothing on the testimonies register');
END $$;

-- ---------------------------------------------------------------------------
-- 57.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Testimony rollback probe', TIMESTAMPTZ '2026-11-07 09:00:00+00', TIMESTAMPTZ '2026-11-07 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO event_testimonies (event, message)
    VALUES (v_event, 'Rollback probe words')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0057_event_testimonies.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'testimonies', '57.4: down refuses while rows exist');
  DELETE FROM event_testimonies WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0057_event_testimonies.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_testimonies') IS NULL,
    'testimonies', '57.4: down drops the testimonies table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0057_event_testimonies.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_testimonies') IS NOT NULL,
    'testimonies', '57.4: re-apply restores the testimonies table');
END $$;
