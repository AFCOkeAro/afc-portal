-- Suite 49: role grant overrides (AFC-836, migration 0049).
--
--   49.1 rerun         -- re-applying 20261028_0049 does nothing.
--   49.2 shape         -- one row per triple names grant|revoke and can
--                         carry a Directus snapshot for symmetric undo;
--                         duplicates are refused.
--   49.3 grants        -- directus_app SELECTs and toggles (INSERT +
--                         DELETE, no UPDATE); PUBLIC holds nothing.
--   49.4 rollback      -- the SHIPPED down script refuses with rows
--                         present; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0049_role_grant_overrides.sql
\i services/directus/schema/migrations/20261028_0049_role_grant_overrides.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'roles', '49.1: 0049 re-apply is a no-op (idempotent forward)');
  INSERT INTO role_grant_overrides (role_key, collection, action, effect, snapshot)
    VALUES ('branch_admin', 'events', 'delete', 'revoke',
            '{"deleted": [{"policy": "p1", "collection": "events", "action": "delete"}]}');
  PERFORM test_support.assert_true(
    (SELECT effect FROM role_grant_overrides
      WHERE role_key = 'branch_admin' AND collection = 'events' AND action = 'delete') = 'revoke',
    'roles', '49.2: a revoke delta with a snapshot writes');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO role_grant_overrides (role_key, collection, action, effect) VALUES (''branch_admin'', ''events'', ''delete'', ''grant'')',
    '23505', 'roles', '49.2: the same triple cannot name both directions');
  UPDATE role_grant_overrides SET effect = 'grant'
    WHERE role_key = 'branch_admin' AND collection = 'events' AND action = 'delete';
  PERFORM test_support.assert_true(
    (SELECT effect FROM role_grant_overrides
      WHERE role_key = 'branch_admin' AND collection = 'events' AND action = 'delete') = 'grant',
    'roles', '49.2: a delta flips direction in place');
  DELETE FROM role_grant_overrides WHERE role_key = 'branch_admin';
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM role_grant_overrides) = 0,
    'roles', '49.2: deltas toggle off cleanly');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.role_grant_overrides', 'SELECT'),
    'roles', '49.3: app reads the delta table');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.role_grant_overrides', 'INSERT, DELETE'),
    'roles', '49.3: app toggles deltas');
  PERFORM test_support.assert_true(
    NOT has_table_privilege('directus_app', 'public.role_grant_overrides', 'UPDATE'),
    'roles', '49.3: app cannot UPDATE deltas (toggle = delete + insert)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'role_grant_overrides'
        AND grantee = 'PUBLIC') = 0,
    'roles', '49.3: PUBLIC holds nothing on the delta table');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'role_grant_overrides'
        AND grantee = 'PUBLIC') = 0,
    'roles', '49.3: PUBLIC holds no column on the delta table');
END $$;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  INSERT INTO role_grant_overrides (role_key, collection, action, effect)
    VALUES ('zone_admin', 'events', 'delete', 'revoke');
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0049_role_grant_overrides.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'roles',
    '49.4: down refuses while deltas exist');
  DELETE FROM role_grant_overrides WHERE role_key = 'zone_admin';
END $test$;
\i services/directus/schema/migrations/rollback/20261028_0049_role_grant_overrides.down.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.role_grant_overrides') IS NULL,
    'roles', '49.4: down drops the delta table when empty');
END $$;
\i services/directus/schema/migrations/20261028_0049_role_grant_overrides.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.role_grant_overrides') IS NOT NULL,
    'roles', '49.4: re-apply restores the delta table');
END $$;
