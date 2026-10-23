-- Suite 99: group writes (AFC-758, migration 0040).
--
--   99.1  rerun         -- re-applying 20261023_0040 changes nothing.
--   99.2  guards        -- directus_app inserts/updates groups + junction
--                         rows, deletes nothing, PUBLIC holds nothing.
--   99.3  rollback      -- the SHIPPED down script revokes exactly the
--                         added grants (probed live); re-applying 0040
--                         forward restores them.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261023_0040_departments_group_write.sql

-- ---------------------------------------------------------------------------
-- 99.1  RERUN. Re-applying 0040 changes nothing (GRANT is idempotent).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261023_0040_departments_group_write.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'groupwrite',
    '99.1: 0040 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 99.2  GUARDS. The app ceiling over the new writes: insert/update yes,
--        delete never, PUBLIC nothing. Fixture rows use fixed ids and are
--        removed at the end (probe() rolls its statements back, so the
--        fixtures below are plain INSERTs).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_area uuid;
BEGIN
  SELECT id INTO v_area FROM areas WHERE code = 'LAG-NORTH' LIMIT 1;

  INSERT INTO departments (id, name, code, department_type, area, description, status) VALUES
    ('99111111-1111-4111-8111-111111111111', '99 Probe Group', 'PROBE-99-GROUP', 'group', v_area, 'probe', 'active');
  INSERT INTO people (id, first_name, last_name, status, created_at, is_entrepreneur) VALUES
    ('99222222-2222-4222-8222-222222222222', 'Probe', 'Leader', 'active', now(), false);

  PERFORM test_support.assert_not_raises('directus_app',
    format('INSERT INTO departments (id, name, code, department_type, area, description, status) VALUES (%L, %L, %L, %L, %L, %L, %L)',
      '99111111-1111-4111-8111-111111111112', '99 Probe Group 2', 'PROBE-99-GROUP-2', 'group', v_area, 'probe', 'active'),
    'groupwrite', 'directus_app inserts a group row');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE departments SET description = 'probe v2' WHERE id = '99111111-1111-4111-8111-111111111111'$q$,
    'groupwrite', 'directus_app updates a group row');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM departments WHERE id = '99111111-1111-4111-8111-111111111111'$q$,
    '42501', 'groupwrite', 'directus_app still has no DELETE on departments');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO people_departments (people, departments, role, joined_at, status) VALUES ('99222222-2222-4222-8222-222222222222', '99111111-1111-4111-8111-111111111111', 'leader', DATE '2026-10-23', 'active')$q$,
    'groupwrite', 'directus_app inserts a junction row');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM people_departments WHERE people = '99222222-2222-4222-8222-222222222222'$q$,
    '42501', 'groupwrite', 'directus_app still has no DELETE on people_departments');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('departments', 'people_departments')
        AND grantee = 'PUBLIC') = 0,
    'groupwrite', 'PUBLIC holds no privilege on either table');

  DELETE FROM people_departments WHERE departments = '99111111-1111-4111-8111-111111111111';
  DELETE FROM departments WHERE id IN ('99111111-1111-4111-8111-111111111111', '99111111-1111-4111-8111-111111111112');
  PERFORM test_support.as_role('directus_migrator',
    $q$DELETE FROM people WHERE id = '99222222-2222-4222-8222-222222222222'$q$);
  PERFORM test_support.as_role(NULL, $q$SELECT 1$q$);
END $$;

-- 99.3  ROLLBACK. The SHIPPED down script revokes exactly the added
--        grants; re-applying 0040 forward restores them. Probed live
--        (the grant state is global, and the file re-applies cleanly).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261023_0040_departments_group_write.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO departments (name, code, department_type, status) VALUES ('probe', 'PROBE-X', 'group', 'active')$q$,
    '42501', 'groupwrite', 'after down: INSERT on departments is refused');
END $$;

\i services/directus/schema/migrations/20261023_0040_departments_group_write.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.departments', 'id', 'INSERT'),
    'groupwrite', 'after re-apply: INSERT on departments is back');
END $$;
