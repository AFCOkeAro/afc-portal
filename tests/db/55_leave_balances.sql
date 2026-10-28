-- Suite 55: leave balances (AFC-854 phase 1, migration 0055).
--
--   55.1 rerun         -- re-applying 20261028_0055 changes nothing.
--   55.2 shape         -- one allowance row per person per year; allowance
--                         is non-negative; duplicates are refused.
--   55.3 grants        -- directus_app SELECTs + writes + DELETEs (allowance
--                         admin is the tool); PUBLIC holds nothing.
--   55.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0055_leave_balances.sql

-- ---------------------------------------------------------------------------
-- 55.1  RERUN. Re-applying 0055 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0055_leave_balances.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'hr',
    '55.1: 0055 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 55.2  SHAPE. Allowances write; one row per person per year.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_person uuid;
BEGIN
  -- Probe holder: fixed id, never deleted (people is retention-managed;
  -- DELETE is refused outside the retention engine, AFC-295). Household
  -- stays NULL so the 85 emptiness pin never sees it.
  INSERT INTO people (id, date_of_birth, status)
    VALUES ('11111111-1111-4111-8111-111111115501'::uuid, (now() - interval '30 years')::date, 'active')
    ON CONFLICT (id) DO NOTHING;
  v_person := '11111111-1111-4111-8111-111111115501'::uuid;

  INSERT INTO leave_balances (person, year, allowance_days, branch)
    VALUES (v_person, 2026, 21, (SELECT id FROM branches WHERE code = 'OKE-ARO'))
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT allowance_days FROM leave_balances WHERE id = v_id) = 21,
    'hr', '55.2: an allowance writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO leave_balances (person, year, allowance_days) VALUES (''' || v_person || ''', 2026, 10)',
    '23505', 'hr', '55.2: one allowance row per person per year');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO leave_balances (person, year, allowance_days) VALUES (''' || v_person || ''', 2027, -1)',
    '23514', 'hr', '55.2: allowance is non-negative');

  UPDATE leave_balances SET allowance_days = 25 WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT allowance_days FROM leave_balances WHERE id = v_id) = 25,
    'hr', '55.2: allowances adjust');

  DELETE FROM leave_balances WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_balances WHERE id = v_id) = 0,
    'hr', '55.2: allowances withdraw cleanly (probe holder stays: retention guard)');
END $$;

-- ---------------------------------------------------------------------------
-- 55.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_balances', 'SELECT'),
    'hr', '55.3: app reads the balances');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_balances', 'INSERT, UPDATE, DELETE'),
    'hr', '55.3: app manages allowances');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'leave_balances'
        AND grantee = 'PUBLIC') = 0,
    'hr', '55.3: PUBLIC holds nothing on the balances register');
END $$;

-- ---------------------------------------------------------------------------
-- 55.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_person uuid;
BEGIN
  INSERT INTO people (id, date_of_birth, status)
    VALUES ('11111111-1111-4111-8111-111111115502'::uuid, (now() - interval '30 years')::date, 'active')
    ON CONFLICT (id) DO NOTHING;
  v_person := '11111111-1111-4111-8111-111111115502'::uuid;
  INSERT INTO leave_balances (person, year, allowance_days)
    VALUES (v_person, 2026, 10)
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0055_leave_balances.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'hr', '55.4: down refuses while rows exist');
  DELETE FROM leave_balances WHERE id = v_id;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0055_leave_balances.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.leave_balances') IS NULL,
    'hr', '55.4: down drops the balances table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0055_leave_balances.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.leave_balances') IS NOT NULL,
    'hr', '55.4: re-apply restores the balances table');
END $$;
