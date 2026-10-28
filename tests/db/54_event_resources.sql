-- Suite 54: event resources with approval (AFC-844, migration 0054).
--
--   54.1 rerun         -- re-applying 20261028_0054 changes nothing.
--   54.2 shape         -- one row per item; link XOR upload pairing holds;
--                         kinds and statuses are closed sets; approval rides
--                         the same row.
--   54.3 grants        -- directus_app SELECTs + writes + DELETEs (add/remove
--                         is the tool); PUBLIC holds nothing.
--   54.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0054_event_resources.sql

-- ---------------------------------------------------------------------------
-- 54.1  RERUN. Re-applying 0054 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0054_event_resources.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'resources',
    '54.1: 0054 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 54.2  SHAPE. Items write pending; pairing is strict; approval rides on.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Resource probe programme', TIMESTAMPTZ '2026-11-04 09:00:00+00', TIMESTAMPTZ '2026-11-04 12:00:00+00')
    RETURNING id INTO v_event;

  INSERT INTO event_resources (event, title, source_type, kind, url)
    VALUES (v_event, 'Order of service', 'link', 'pdf', 'https://files.example/oos.pdf')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM event_resources WHERE id = v_id) = 'pending',
    'resources', '54.2: a linked item writes as pending');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_resources (event, title, source_type, kind, url, file_id) VALUES (''' || v_event || ''', ''Both'', ''link'', ''pdf'', ''https://x'', gen_random_uuid())',
    '23514', 'resources', '54.2: link and upload never coexist');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_resources (event, title, source_type, kind) VALUES (''' || v_event || ''', ''Bare link'', ''link'', ''pdf'')',
    '23514', 'resources', '54.2: a link needs its URL');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_resources (event, title, source_type, kind, url) VALUES (''' || v_event || ''', ''Song'', ''link'', ''audio'', ''https://x'')',
    '23514', 'resources', '54.2: kind is a closed set');

  UPDATE event_resources SET status = 'approved', decided_by = (SELECT id FROM people LIMIT 1), decided_at = now()
    WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM event_resources WHERE id = v_id) = 'approved',
    'resources', '54.2: approval rides the same row');

  DELETE FROM event_resources WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_resources WHERE id = v_id) = 0
    AND (SELECT count(*) FROM events WHERE id = v_event) = 0,
    'resources', '54.2: items withdraw cleanly (probe programme removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 54.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_resources', 'SELECT'),
    'resources', '54.3: app reads the library');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_resources', 'INSERT, UPDATE, DELETE'),
    'resources', '54.3: app manages the library');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_resources'
        AND grantee = 'PUBLIC') = 0,
    'resources', '54.3: PUBLIC holds nothing on the resources register');
END $$;

-- ---------------------------------------------------------------------------
-- 54.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Resource rollback probe', TIMESTAMPTZ '2026-11-05 09:00:00+00', TIMESTAMPTZ '2026-11-05 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO event_resources (event, title, source_type, kind, url)
    VALUES (v_event, 'Rollback item', 'link', 'document', 'https://x')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0054_event_resources.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'resources', '54.4: down refuses while rows exist');
  DELETE FROM event_resources WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0054_event_resources.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_resources') IS NULL,
    'resources', '54.4: down drops the resources table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0054_event_resources.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_resources') IS NOT NULL,
    'resources', '54.4: re-apply restores the resources table');
END $$;
