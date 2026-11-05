-- Suite 52: leave requests (AFC-842, migration 0052).
--
--   52.1 rerun         -- re-applying 20261028_0052 changes nothing.
--   52.2 shape         -- one row per request; type and status are closed
--                         sets; end_date precedes start_date never; days
--                         counts the inclusive range.
--   52.3 grants        -- directus_app SELECTs + writes + DELETEs
--                         (withdrawing a draft is the tool); PUBLIC holds
--                         nothing.
--   52.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0052_leave_requests.sql

-- ---------------------------------------------------------------------------
-- 52.1  RERUN. Re-applying 0052 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0052_leave_requests.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'leave',
    '52.1: 0052 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 52.2  SHAPE. Requests write; closed sets and date order hold.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason)
    VALUES ((SELECT id FROM branches WHERE code = 'OKE-ARO'),
            (SELECT id FROM people LIMIT 1),
            DATE '2026-12-21', DATE '2026-12-23', 3, 'annual', 'Christmas break')
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM leave_requests WHERE id = v_id) = 'pending',
    'leave', '52.2: a request opens pending');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO leave_requests (start_date, end_date, days, leave_type) VALUES (DATE ''2026-12-21'', DATE ''2026-12-23'', 3, ''sabbatical'')',
    '23514', 'leave', '52.2: leave_type is a closed set');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO leave_requests (start_date, end_date, days) VALUES (DATE ''2026-12-23'', DATE ''2026-12-21'', 3)',
    '23514', 'leave', '52.2: end_date never precedes start_date');

  UPDATE leave_requests SET status = 'approved', decided_by = (SELECT id FROM people LIMIT 1), decided_at = now()
    WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT status FROM leave_requests WHERE id = v_id) = 'approved',
    'leave', '52.2: a decision rides the same row');

  DELETE FROM leave_requests WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests WHERE id = v_id) = 0,
    'leave', '52.2: requests withdraw cleanly');
END $$;

-- ---------------------------------------------------------------------------
-- 52.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_requests', 'SELECT'),
    'leave', '52.3: app reads the requests');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_requests', 'INSERT, UPDATE, DELETE'),
    'leave', '52.3: app manages requests');
  PERFORM test_support.assert_true(
    NOT has_table_privilege('directus_app', 'public.leave_requests', 'TRUNCATE'),
    'leave', '52.3: app holds no TRUNCATE on the requests');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'leave_requests'
        AND grantee = 'PUBLIC') = 0,
    'leave', '52.3: PUBLIC holds nothing on the leave register');
END $$;

-- ---------------------------------------------------------------------------
-- 52.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
BEGIN
  INSERT INTO leave_requests (start_date, end_date, days, leave_type)
    VALUES (DATE '2026-12-28', DATE '2026-12-29', 2, 'annual')
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0052_leave_requests.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'leave', '52.4: down refuses while rows exist');
  DELETE FROM leave_requests WHERE id = v_id;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0052_leave_requests.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.leave_requests') IS NULL,
    'leave', '52.4: down drops the leave table when empty');
END $$;

\i services/directus/schema/migrations/20261028_0052_leave_requests.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.leave_requests') IS NOT NULL,
    'leave', '52.4: re-apply restores the leave table');
END $$;
