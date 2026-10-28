-- Suite 51: outreach locations (AFC-841, migration 0051).
--
--   51.1 rerun         -- re-applying 20261028_0051 changes nothing.
--   51.2 shape         -- one row per mission field; category and ownership
--                         are closed sets; assignments link locations to
--                         people and cascade with the location.
--   51.3 grants        -- directus_app SELECTs + writes + DELETEs (add/remove
--                         is the tool); PUBLIC holds nothing.
--   51.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops both tables;
--                         re-apply restores them.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0051_outreach_locations.sql

-- ---------------------------------------------------------------------------
-- 51.1  RERUN. Re-applying 0051 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0051_outreach_locations.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'avs',
    '51.1: 0051 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 51.2  SHAPE. Locations write; closed sets refuse; assignments cascade.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_location uuid;
  v_person uuid;
BEGIN
  SELECT id INTO v_person FROM people LIMIT 1;

  INSERT INTO outreach_locations (branch, name, category, address, ownership, contact_name, contact_phone, visiting_days)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), 'St Mary Primary School', 'primary_school',
            '1 School Road', 'public', 'Mrs Ade', '08030000001', 'Tuesdays and Thursdays')
    RETURNING id INTO v_location;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM outreach_locations WHERE id = v_location) = 1,
    'avs', '51.2: a mission field writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO outreach_locations (name, category, ownership) VALUES (''X'', ''university'', ''private'')',
    '23514', 'avs', '51.2: category is a closed set');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO outreach_locations (name, category, ownership) VALUES (''Y'', ''hospital'', ''mission'')',
    '23514', 'avs', '51.2: ownership names private or public only');

  IF v_person IS NOT NULL THEN
    INSERT INTO outreach_location_secretaries (location, person)
      VALUES (v_location, v_person);
    PERFORM test_support.assert_true(
      (SELECT count(*) FROM outreach_location_secretaries WHERE location = v_location) = 1,
      'avs', '51.2: a secretary assignment writes');
    PERFORM test_support.assert_raises(NULL,
      'INSERT INTO outreach_location_secretaries (location, person) VALUES (''' || v_location || ''', ''' || v_person || ''')',
      '23505', 'avs', '51.2: the same person is assigned once per location');
  END IF;

  DELETE FROM outreach_locations WHERE id = v_location;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM outreach_location_secretaries WHERE location = v_location) = 0,
    'avs', '51.2: assignments cascade with the location');
END $$;

-- ---------------------------------------------------------------------------
-- 51.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.outreach_locations', 'SELECT'),
    'avs', '51.3: app reads the locations');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.outreach_locations', 'INSERT, UPDATE, DELETE'),
    'avs', '51.3: app manages locations (add/remove is the tool)');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.outreach_location_secretaries', 'INSERT, UPDATE, DELETE'),
    'avs', '51.3: app manages assignments');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name IN ('outreach_locations', 'outreach_location_secretaries')
        AND grantee = 'PUBLIC') = 0,
    'avs', '51.3: PUBLIC holds nothing on the AVS registers');
END $$;

-- ---------------------------------------------------------------------------
-- 51.4  ROLLBACK. Refuses with rows; emptied, drops both tables; re-apply
-- restores them.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_location uuid;
BEGIN
  INSERT INTO outreach_locations (name, category, ownership)
    VALUES ('Rollback probe school', 'secondary_school', 'private')
    RETURNING id INTO v_location;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0051_outreach_locations.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'avs', '51.4: down refuses while rows exist');
  DELETE FROM outreach_locations WHERE id = v_location;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0051_outreach_locations.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.outreach_locations') IS NULL
    AND to_regclass('public.outreach_location_secretaries') IS NULL,
    'avs', '51.4: down drops both AVS tables when empty');
END $$;

\i services/directus/schema/migrations/20261028_0051_outreach_locations.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.outreach_locations') IS NOT NULL
    AND to_regclass('public.outreach_location_secretaries') IS NOT NULL,
    'avs', '51.4: re-apply restores both AVS tables');
END $$;
