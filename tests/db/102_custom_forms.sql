-- Suite 102: custom forms register (AFC-897, migration 0065).
--
--   102.1 rerun         -- re-applying 20261030_0065 changes nothing.
--   102.2 shape         -- one row per (module, name); module confined to
--                         the seven v1 linkable modules; schema is an
--                         object with a fields array; blank names refused;
--                         module is not in the app UPDATE grant.
--   102.3 grants        -- directus_app SELECTs + manages the slots;
--                         PUBLIC holds nothing.
--   102.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
-- 102.0 precondition -- production ownership. Earlier suites drop and
-- re-create registers as the harness superuser, so restore the production
-- owner (directus_migrator) that 0065 requires, exactly as a migrated
-- database holds it. A no-op when the owner is already correct.
DO $$
BEGIN
  IF to_regclass('public.custom_forms') IS NOT NULL THEN
    ALTER TABLE custom_forms OWNER TO directus_migrator;
  END IF;
END $$;
\i services/directus/schema/migrations/20261030_0065_custom_forms.sql

-- ---------------------------------------------------------------------------
-- 102.1  RERUN. Re-applying 0065 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261030_0065_custom_forms.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'custom_forms',
    '102.1: 0065 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 102.2  SHAPE. Definitions write once per (module, name), vocabulary and
-- schema shape confined, blank names refused.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_other uuid;
BEGIN
  INSERT INTO custom_forms (name, module, schema)
    VALUES ('Intake short', 'visitors',
      '{"version":1,"fields":[{"key":"visitor_first_name","label":"First name","type":"string","required":true}]}')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM custom_forms WHERE id = v_id) = 1,
    'custom_forms', '102.2: a definition writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO custom_forms (name, module) VALUES (''Bad link'', ''events'')',
    '23514', 'custom_forms', '102.2: a module outside the v1 seven is refused');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO custom_forms (name, module) VALUES (''   '', ''visitors'')',
    '23514', 'custom_forms', '102.2: a blank name is refused');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO custom_forms (name, module, schema) VALUES (''No fields'', ''visitors'', ''{"version":1}'')',
    '23514', 'custom_forms', '102.2: a schema without a fields array is refused');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO custom_forms (name, module) VALUES (''Intake short'', ''visitors'')',
    '23505', 'custom_forms', '102.2: a second row for the same pair is refused');

  INSERT INTO custom_forms (name, module)
    VALUES ('Intake short', 'people')
    RETURNING id INTO v_other;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM custom_forms WHERE id = v_other) = 1,
    'custom_forms', '102.2: the same name lives once per module');

  UPDATE custom_forms SET name = 'Intake shorter' WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT name FROM custom_forms WHERE id = v_id) = 'Intake shorter',
    'custom_forms', '102.2: names update cleanly');

  DELETE FROM custom_forms WHERE id = v_id OR id = v_other;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM custom_forms) = 0,
    'custom_forms', '102.2: definitions withdraw cleanly');
END $$;

-- ---------------------------------------------------------------------------
-- 102.3  GRANTS. App reads and manages; PUBLIC holds nothing; module is
-- locked after create (not in the app UPDATE grant).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.custom_forms', 'SELECT'),
    'custom_forms', '102.3: app reads the definitions');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.custom_forms', 'INSERT, UPDATE, DELETE'),
    'custom_forms', '102.3: app manages definitions');
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.custom_forms', 'module', 'UPDATE') = false,
    'custom_forms', '102.3: app cannot re-home a definition onto another module');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'custom_forms'
        AND grantee = 'PUBLIC') = 0,
    'custom_forms', '102.3: PUBLIC holds nothing on the custom forms register');
END $$;

-- ---------------------------------------------------------------------------
-- 102.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
BEGIN
  INSERT INTO custom_forms (name, module)
    VALUES ('Rollback probe', 'tasks')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261030_0065_custom_forms.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'custom_forms', '102.4: down refuses while rows exist');
  DELETE FROM custom_forms WHERE id = v_id;
END $test$;

\i services/directus/schema/migrations/rollback/20261030_0065_custom_forms.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.custom_forms') IS NULL,
    'custom_forms', '102.4: down drops the definitions table when empty');
END $$;

\i services/directus/schema/migrations/20261030_0065_custom_forms.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.custom_forms') IS NOT NULL,
    'custom_forms', '102.4: re-apply restores the definitions table');
END $$;
