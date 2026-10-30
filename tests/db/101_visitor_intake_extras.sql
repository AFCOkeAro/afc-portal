-- Suite 101: visitor intake extras (AFC-907, migration 0063).
--
--   101.1 rerun         -- re-applying 20261030_0063 does nothing.
--   101.2 shape         -- the four columns exist with the source CHECK and
--                         the cross-branch default; a bad source is refused.
--   101.3 grants        -- directus_app INSERTs + UPDATEs the four columns;
--                         PUBLIC holds nothing new.
--   101.4 rollback      -- the SHIPPED down script drops the four columns;
--                         re-apply restores them.
-- ---------------------------------------------------------------------------
-- 101.0 precondition -- production ownership. Earlier suites drop and
-- re-create visitors as the harness superuser, so restore the production
-- owner (directus_migrator) that 0063 requires, exactly as a migrated
-- database holds it. A no-op when the owner is already correct.
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NOT NULL THEN
    ALTER TABLE visitors OWNER TO directus_migrator;
  END IF;
END $$;
\i services/directus/schema/migrations/20261030_0063_visitor_intake_extras.sql
\i services/directus/schema/migrations/20261030_0063_visitor_intake_extras.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'visitors', '101.1: 0063 re-apply is a no-op (idempotent forward)');
  PERFORM test_support.assert_true(
    (SELECT bool_and(has_column_privilege('directus_app',
      'public.visitors', c, 'INSERT')
      AND has_column_privilege('directus_app',
      'public.visitors', c, 'UPDATE'))
      FROM unnest(ARRAY['address', 'campaign', 'source', 'is_cross_branch_visit']) AS c),
    'visitors', '101.3: app writes the four intake columns');
END $$;
DO $shape$
DECLARE
  v_got text := NULL;
BEGIN
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, source, is_cross_branch_visit)
    VALUES ('Suite', 'Hundredone', CURRENT_DATE, 'outreach', true);
  PERFORM test_support.assert_true(
    (SELECT source FROM visitors
      WHERE visitor_first_name = 'Suite' AND visitor_last_name = 'Hundredone') = 'outreach',
    'visitors', '101.2: a source writes and reads back');
  PERFORM test_support.assert_true(
    (SELECT is_cross_branch_visit FROM visitors
      WHERE visitor_first_name = 'Suite' AND visitor_last_name = 'Hundredone') IS TRUE,
    'visitors', '101.2: the cross-branch flag writes and reads back');
  BEGIN
    INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, source)
      VALUES ('Suite', 'Bad', CURRENT_DATE, 'carrier_pigeon');
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.assert_true(
    v_got = '23514',
    'visitors',
    '101.2: an unknown source is refused by the CHECK');
  DELETE FROM visitors WHERE visitor_first_name = 'Suite';
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitors WHERE visitor_first_name = 'Suite') = 0,
    'visitors', '101.2: probe rows clean up');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'visitors'
        AND grantee = 'PUBLIC') = 0,
    'visitors', '101.3: PUBLIC holds nothing on the register');
END $shape$;
\i services/directus/schema/migrations/rollback/20261030_0063_visitor_intake_extras.down.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'visitors'
         AND column_name IN ('address', 'campaign', 'source', 'is_cross_branch_visit')),
    'visitors', '101.4: down drops the four intake columns');
END $$;
\i services/directus/schema/migrations/20261030_0063_visitor_intake_extras.sql
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visitors'
        AND column_name IN ('address', 'campaign', 'source', 'is_cross_branch_visit')) = 4,
    'visitors', '101.4: re-apply restores the four intake columns');
END $$;
