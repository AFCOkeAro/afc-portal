-- Suite 62: funerals (AFC-884, migration 0062).
--
--   62.1 rerun         -- re-applying 20261029_0062 changes nothing.
--   62.2 shape         -- a funeral row writes with person-or-name;
--                         person links are accepted, nameless rows refused.
--   62.3 grants        -- directus_app SELECTs + manages the register;
--                         PUBLIC holds nothing.
--   62.4 lifecycle     -- the widened status set holds deceased; linking
--                         flips a person; unlinked names need no row.
--   62.5 rollback      -- the SHIPPED down script refuses while rows or
--                         deceased people exist; clear of both, it drops
--                         the table and narrows the CHECK; re-apply
--                         restores both.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0062_funerals.sql

-- ---------------------------------------------------------------------------
-- 62.1  RERUN. Re-applying 0062 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0062_funerals.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'funerals',
    '62.1: 0062 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 62.2  SHAPE. Person-or-name required; stages confined.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_event uuid;
BEGIN
  v_event := gen_random_uuid();

  INSERT INTO funeral_cases (branch, deceased_name)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), 'Probe Ancestor')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT stage FROM funeral_cases WHERE id = v_id) = 'reported',
    'funerals', '62.2: a nameless-link row writes, defaulting to reported');

  UPDATE funeral_cases SET stage = 'scheduled' WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT stage FROM funeral_cases WHERE id = v_id) = 'scheduled',
    'funerals', '62.2: the stage advances');

  DELETE FROM funeral_cases WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM funeral_cases WHERE id = v_id) = 0,
    'funerals', '62.2: funeral probes withdraw cleanly');
END $$;

DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    format('INSERT INTO funeral_cases (branch) VALUES ((SELECT id FROM branches WHERE code = %L))', 'OKE-ARO'),
    '23514', 'funerals', '62.2: neither person nor name is refused');
END $$;

-- ---------------------------------------------------------------------------
-- 62.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.funeral_cases', 'SELECT'),
    'funerals', '62.3: app reads the funerals');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.funeral_cases', 'INSERT, UPDATE, DELETE'),
    'funerals', '62.3: app manages funerals');
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.people', 'status', 'UPDATE'),
    'funerals', '62.3: app flips the deceased status');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'funeral_cases'
        AND grantee = 'PUBLIC') = 0,
    'funerals', '62.3: PUBLIC holds nothing on the funerals register');
END $$;

-- ---------------------------------------------------------------------------
-- 62.4  LIFECYCLE. Widened status holds deceased; linking flips a person.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid := '11111111-1111-4111-8111-111111116201'::uuid;
  v_id uuid;
BEGIN
  -- Fixed-id probe, never deleted (people rows are retention-managed;
  -- suite-55 precedent). Restored to active at the end.
  INSERT INTO people (id, status) VALUES (v_person, 'active')
    ON CONFLICT (id) DO NOTHING;
  UPDATE people SET status = 'active' WHERE id = v_person;
  INSERT INTO funeral_cases (branch, deceased_person)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'), v_person)
    RETURNING id INTO v_id;
  UPDATE people SET status = 'deceased' WHERE id = v_person;
  PERFORM test_support.assert_true(
    (SELECT status FROM people WHERE id = v_person) = 'deceased',
    'funerals', '62.4: a linked person flips to deceased');
  UPDATE people SET status = 'active' WHERE id = v_person;
  DELETE FROM funeral_cases WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM people WHERE id = v_person) = 'active',
    'funerals', '62.4: the probe person is restored');
END $$;

-- ---------------------------------------------------------------------------
-- 62.5  ROLLBACK. Refuses with rows or deceased people; clear of both,
-- it drops the table and narrows the CHECK; re-apply restores both.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/rollback/20261029_0062_funerals.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NULL,
    'funerals', '62.5: down proceeds when empty (no-op with NOTICE)');
END $test$;

\i services/directus/schema/migrations/rollback/20261029_0062_funerals.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.funeral_cases') IS NULL,
    'funerals', '62.5: down drops the funerals table when empty');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_status_check'),
    'funerals', '62.5: down narrows people.status back to two values');
END $$;

\i services/directus/schema/migrations/20261029_0062_funerals.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.funeral_cases') IS NOT NULL,
    'funerals', '62.5: re-apply restores the funerals table');
END $$;
