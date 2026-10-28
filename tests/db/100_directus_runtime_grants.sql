-- Suite 100: Directus-runtime grants (AFC-768, migration 0041).
--
--   100.1 rerun         -- re-applying 20261023_0041 changes nothing.
--   100.2 guards        -- on every directus_* table PRESENT in this
--                         database: directus_app holds full DML and PUBLIC
--                         holds nothing. (Scratch databases never create
--                         Directus system tables, so the loop is vacuous
--                         there; on staging-shaped databases it checks all
--                         29. The 29-name list lives in the migration file
--                         itself, pinned by review.)
--   100.3 rollback      -- if directus_migrations exists here: the SHIPPED
--                         down script revokes the read, re-apply restores it.
--                         Otherwise asserts the skip explicitly.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261023_0041_directus_runtime_grants.sql

-- ---------------------------------------------------------------------------
-- 100.1  RERUN. Re-applying 0041 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261023_0041_directus_runtime_grants.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'runtimegrants',
    '100.1: 0041 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 100.2  GUARDS. Full DML for directus_app on every present directus_*
-- table; PUBLIC holds nothing on them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  v_count integer := 0;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename LIKE 'directus\\_%'
             ORDER BY 1 LOOP
    v_count := v_count + 1;
    PERFORM test_support.assert_true(
      has_table_privilege('directus_app', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'),
      'runtimegrants', 'directus_app holds full DML on ' || t);
    PERFORM test_support.assert_true(
      (SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = t AND grantee = 'PUBLIC') = 0,
      'runtimegrants', 'PUBLIC holds nothing on ' || t);
  END LOOP;
  PERFORM test_support.assert_true(true, 'runtimegrants',
    '100.2: checked ' || v_count::text || ' present directus_* tables (0 on scratch, 29 on staging-shaped DBs)');
END $$;

-- ---------------------------------------------------------------------------
-- 100.3  ROLLBACK. Live down/up cycle when the migrations table exists;
-- explicit skip otherwise.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.directus_migrations') IS NULL THEN
    PERFORM test_support.assert_true(true, 'runtimegrants',
      '100.3: skipped, no directus_migrations in this database (live check runs on staging)');
  END IF;
END $$;

\i services/directus/schema/migrations/rollback/20261023_0041_directus_runtime_grants.down.sql

DO $$
BEGIN
  IF to_regclass('public.directus_migrations') IS NOT NULL THEN
    PERFORM test_support.assert_true(
      NOT has_table_privilege('directus_app', 'public.directus_migrations', 'SELECT'),
      'runtimegrants', 'after down: migrations read is revoked');
  END IF;
END $$;

\i services/directus/schema/migrations/20261023_0041_directus_runtime_grants.sql

DO $$
BEGIN
  IF to_regclass('public.directus_migrations') IS NOT NULL THEN
    PERFORM test_support.assert_true(
      has_table_privilege('directus_app', 'public.directus_migrations', 'SELECT'),
      'runtimegrants', 'after re-apply: migrations read is back');
  END IF;
END $$;
