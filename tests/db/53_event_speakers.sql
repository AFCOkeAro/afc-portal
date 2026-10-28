-- Suite 53: event speakers (AFC-843, migration 0053).
--
--   53.1 rerun         -- re-applying 20261028_0053 changes nothing.
--   53.2 shape         -- one row per booking; person XOR external name;
--                         status is a closed set.
--   53.3 grants        -- directus_app SELECTs + writes + DELETEs (add/remove
--                         is the tool); PUBLIC holds nothing.
--   53.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0053_event_speakers.sql

-- ---------------------------------------------------------------------------
-- 53.1  RERUN. Re-applying 0053 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0053_event_speakers.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'speakers',
    '53.1: 0053 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 53.2  SHAPE. Bookings write; person XOR name; closed status set.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
  v_person uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Speaker probe programme', TIMESTAMPTZ '2026-11-02 09:00:00+00', TIMESTAMPTZ '2026-11-02 12:00:00+00')
    RETURNING id INTO v_event;
  SELECT id INTO v_person FROM people LIMIT 1;

  -- External-guest booking (no directory dependency).
  INSERT INTO event_speakers (event, branch, external_name, status, special_requests)
    VALUES (v_event, (SELECT branch FROM events WHERE id = v_event),
            'Guest Minister', 'pending', 'Wheelchair access to the pulpit')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM event_speakers WHERE id = v_id) = 'pending',
    'speakers', '53.2: an external-guest booking writes as pending');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_speakers (event, external_name, status) VALUES (''' || v_event || ''', ''Guest'', ''maybe'')',
    '23514', 'speakers', '53.2: status is a closed set');

  IF v_person IS NOT NULL THEN
    INSERT INTO event_speakers (event, person, status)
      VALUES (v_event, v_person, 'invited');
    PERFORM test_support.assert_true(
      (SELECT count(*) FROM event_speakers WHERE event = v_event AND person = v_person) = 1,
      'speakers', '53.2: a directory-person booking writes');
    PERFORM test_support.assert_raises(NULL,
      'INSERT INTO event_speakers (event, person, external_name, status) VALUES (''' || v_event || ''', ''' || v_person || ''', ''Guest'', ''invited'')',
      '23514', 'speakers', '53.2: person and external name never coexist');
    DELETE FROM event_speakers WHERE event = v_event AND person = v_person;
  END IF;

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_speakers (event, status) VALUES (''' || v_event || ''', ''pending'')',
    '23514', 'speakers', '53.2: a booking with neither person nor name is refused');

  UPDATE event_speakers SET status = 'booked' WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM event_speakers WHERE id = v_id) = 'booked',
    'speakers', '53.2: pending moves to booked');

  DELETE FROM event_speakers WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_speakers WHERE id = v_id) = 0
    AND (SELECT count(*) FROM events WHERE id = v_event) = 0,
    'speakers', '53.2: bookings withdraw cleanly (probe programme removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 53.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_speakers', 'SELECT'),
    'speakers', '53.3: app reads the bookings');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_speakers', 'INSERT, UPDATE, DELETE'),
    'speakers', '53.3: app manages bookings');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_speakers'
        AND grantee = 'PUBLIC') = 0,
    'speakers', '53.3: PUBLIC holds nothing on the speakers register');
END $$;

-- ---------------------------------------------------------------------------
-- 53.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Speaker rollback probe programme', TIMESTAMPTZ '2026-11-03 09:00:00+00', TIMESTAMPTZ '2026-11-03 12:00:00+00')
    RETURNING id INTO v_event;
  INSERT INTO event_speakers (event, external_name, status)
    VALUES (v_event, 'Rollback probe guest', 'invited')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0053_event_speakers.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'speakers', '53.4: down refuses while rows exist');
  DELETE FROM event_speakers WHERE id = v_id;
  DELETE FROM events WHERE id = v_event;
END $test$;

-- AFC-844: park the resources speaker link so the 0053 down script can
-- drop its referent (the down script refuses to touch a landed 844 link
-- itself). Restored after the re-apply below.
ALTER TABLE IF EXISTS event_resources DROP CONSTRAINT IF EXISTS event_resources_speaker_fkey;

\i services/directus/schema/migrations/rollback/20261028_0053_event_speakers.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_speakers') IS NULL,
    'speakers', '53.4: down drops the speakers table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0053_event_speakers.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_speakers') IS NOT NULL,
    'speakers', '53.4: re-apply restores the speakers table');
END $$;

-- AFC-844: restore the parked speaker link (conditional merge-contract
-- form, mirroring 0054 §2: only when event_speakers exists).
DO $$
BEGIN
  IF to_regclass('public.event_speakers') IS NULL THEN
    RAISE NOTICE 'Skipping event_resources_speaker_fkey restore: event_speakers absent.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_resources_speaker_fkey') THEN
    ALTER TABLE event_resources ADD CONSTRAINT event_resources_speaker_fkey
      FOREIGN KEY (speaker) REFERENCES event_speakers(id) ON DELETE SET NULL;
  END IF;
END $$;
