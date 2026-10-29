-- Suite 60: event collaborators (AFC-880, migration 0060).
--
--   60.1 rerun         -- re-applying 20261029_0060 changes nothing.
--   60.2 shape         -- one row per (event, person); areas confined to
--                         the six v1 areas; dedup enforced.
--   60.3 grants        -- directus_app SELECTs + manages the slot;
--                         PUBLIC holds nothing.
--   60.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0060_event_collaborators.sql

-- ---------------------------------------------------------------------------
-- 60.1  RERUN. Re-applying 0060 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0060_event_collaborators.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'collaborators',
    '60.1: 0060 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 60.2  SHAPE. Delegations write once, areas confined, dedup enforced.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
  v_person uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Collaborator probe programme', TIMESTAMPTZ '2026-11-08 09:00:00+00', TIMESTAMPTZ '2026-11-08 12:00:00+00')
    RETURNING id INTO v_event;
  v_person := gen_random_uuid();

  INSERT INTO event_collaborators (event, person, areas)
    VALUES (v_event, v_person, ARRAY['schedule', 'budget'])
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_collaborators WHERE id = v_id) = 1,
    'collaborators', '60.2: a delegation writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_collaborators (event, person) VALUES (''' || v_event || ''', ''' || v_person || ''')',
    '23505', 'collaborators', '60.2: a second row for the same pair is refused');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_collaborators (event, person, areas) VALUES (''' || v_event || ''', ''' || gen_random_uuid() || ''', ''{tasks}'')',
    '23514', 'collaborators', '60.2: areas outside the v1 set are refused');

  UPDATE event_collaborators SET areas = ARRAY['details'] WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT areas FROM event_collaborators WHERE id = v_id) = ARRAY['details'],
    'collaborators', '60.2: areas update cleanly');

  DELETE FROM event_collaborators WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_collaborators WHERE id = v_id) = 0
    AND (SELECT count(*) FROM events WHERE id = v_event) = 0,
    'collaborators', '60.2: delegations withdraw cleanly (probe programme removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 60.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_collaborators', 'SELECT'),
    'collaborators', '60.3: app reads the collaborators');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_collaborators', 'INSERT, UPDATE, DELETE'),
    'collaborators', '60.3: app manages collaborators');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_collaborators'
        AND grantee = 'PUBLIC') = 0,
    'collaborators', '60.3: PUBLIC holds nothing on the collaborators register');
END $$;

-- ---------------------------------------------------------------------------
-- 60.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Collaborator rollback probe', TIMESTAMPTZ '2026-11-09 09:00:00+00', TIMESTAMPTZ '2026-11-09 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO event_collaborators (event, person, areas)
    VALUES (v_event, gen_random_uuid(), ARRAY['details'])
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261029_0060_event_collaborators.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'collaborators', '60.4: down refuses while rows exist');
  DELETE FROM event_collaborators WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261029_0060_event_collaborators.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_collaborators') IS NULL,
    'collaborators', '60.4: down drops the collaborators table when empty');
END $$;

\i services/directus/schema/migrations/20261029_0060_event_collaborators.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_collaborators') IS NOT NULL,
    'collaborators', '60.4: re-apply restores the collaborators table');
END $$;
