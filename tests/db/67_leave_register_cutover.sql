-- Suite 67: leave register cutover (AFC-1058, migration 0067).
--
--   67.1 shape       -- the register is still the 0052 shape before the cutover.
--   67.2 fail-closed -- each unmappable class blocks apply in scan order,
--                        naming its rows; disposing one class surfaces the
--                        next; a clean register applies.
--   67.3 conversions -- requester_user/person backfilled, maternity->other
--                        and declined->rejected with audit notes, days/person
--                        dropped, ADR-0012 CHECKs/FKs/branch/reason NOT NULL.
--   67.4 grants      -- no DELETE anywhere; PUBLIC holds nothing.
--   67.5 rerun       -- re-applying 0067 changes nothing.
--   67.6 rollback    -- the SHIPPED down script refuses while either table
--                        holds rows; emptied, it restores the 0052 shape
--                        (DELETE grant included); re-apply restores 0067.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 67.1  SHAPE. The migration phase leaves the live register in the cut
--         shape; the SHIPPED down script restores the 0052 shape for the
--         conversion test below (empty register, so it proceeds).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'leave_requests'
                   AND column_name = 'days')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'leave_requests'
                   AND column_name = 'requester_user'),
    'leave', '67.1: the migration phase leaves the register in the cut shape');
END $$;

SET ROLE directus_migrator;
\i services/directus/schema/migrations/rollback/20261105_0067_leave_register_cutover.down.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'leave_requests'
               AND column_name = 'days')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'leave_requests'
                       AND column_name = 'requester_user')
    AND to_regclass('public.leave_request_events') IS NULL,
    'leave', '67.1: the shipped down script restores the 0052 shape on an empty register');
END $$;

-- ---------------------------------------------------------------------------
-- 67.2  FAIL-CLOSED. Seed one row per class, then dispose blockers in scan
--         order. Every refusal is restrict_violation (23001) and names the
--         blocking class.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_person uuid;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
  v_u2 uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  SELECT id INTO v_branch FROM branches WHERE code = 'OKE-ARO';
  SELECT id INTO v_person FROM people LIMIT 1;

  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (v_branch, v_person, DATE '2026-12-21', DATE '2026-12-23', 3, 'annual', 'Christmas break', 'pending', v_u1);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, decided_by, decided_at, created_by)
    VALUES (v_branch, v_person, DATE '2026-11-02', DATE '2026-11-06', 5, 'maternity', 'Parental leave', 'approved', v_u2, now(), v_u2);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (v_branch, NULL, DATE '2026-12-28', DATE '2026-12-29', 2, 'sick', 'Flu', 'declined', v_u1);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (v_branch, v_person, DATE '2026-12-28', DATE '2026-12-29', 2, 'annual', 'Changed mind', 'cancelled', v_u1);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (v_branch, v_person, DATE '2026-12-28', DATE '2026-12-29', 2, 'annual', 'No owner', 'pending', NULL);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (NULL, v_person, DATE '2026-12-28', DATE '2026-12-29', 2, 'annual', 'No scope', 'pending', v_u1);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, created_by)
    VALUES (v_branch, v_person, DATE '2026-12-28', DATE '2026-12-29', 2, 'annual', NULL, 'pending', v_u1);
  INSERT INTO leave_requests (branch, person, start_date, end_date, days, leave_type, reason, status, decided_by, decided_at, created_by)
    VALUES (v_branch, v_person, DATE '2026-12-28', DATE '2026-12-29', 2, 'annual', 'Split stamp', 'approved', v_u2, NULL, v_u1);
END $$;

SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%' AND v_got LIKE '%created_by%',
    'leave', '67.2: cutover refuses first on unattributed rows (created_by NULL)');
END $test$;
RESET ROLE;

DELETE FROM leave_requests WHERE created_by IS NULL;

SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%' AND v_got LIKE '%branch%',
    'leave', '67.2: cutover refuses next on branch-NULL rows');
END $test$;
RESET ROLE;

UPDATE leave_requests SET branch = (SELECT id FROM branches WHERE code = 'OKE-ARO') WHERE branch IS NULL;

SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%' AND v_got LIKE '%reason%',
    'leave', '67.2: cutover refuses next on reason-NULL rows');
END $test$;
RESET ROLE;

UPDATE leave_requests SET reason = 'Year-end cover' WHERE reason IS NULL;

SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%' AND v_got LIKE '%split%',
    'leave', '67.2: cutover refuses next on split decision stamps');
END $test$;
RESET ROLE;

UPDATE leave_requests SET decided_at = now() WHERE decided_by IS NOT NULL AND decided_at IS NULL;

SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%' AND v_got LIKE '%cancelled%',
    'leave', '67.2: cutover refuses last on cancelled rows (no silent drop)');
END $test$;
RESET ROLE;

DELETE FROM leave_requests WHERE status = 'cancelled';

SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests) = 6,
    'leave', '67.2: a clean register applies with every row carried over');
END $$;

-- ---------------------------------------------------------------------------
-- 67.3  CONVERSIONS. Backfills, maps, dropped columns, audited constraints.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
  v_u2 uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM leave_requests WHERE requester_user IS NULL),
    'leave', '67.3: every request has a requester_user after backfill');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests WHERE requester_user = v_u1) = 5,
    'leave', '67.3: requester_user backfills from created_by (u1 rows)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests WHERE requester_user = v_u2) = 1,
    'leave', '67.3: requester_user backfills from created_by (u2 rows)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests WHERE requester_person IS NOT NULL) = 5,
    'leave', '67.3: requester_person backfills from person, NULLs kept');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM leave_requests WHERE leave_type = 'maternity'),
    'leave', '67.3: no maternity value survives the cutover');
  PERFORM test_support.assert_true(
    (SELECT leave_type FROM leave_requests WHERE reason = 'Parental leave') = 'other',
    'leave', '67.3: maternity maps to other (D1)');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM leave_requests WHERE status = 'declined'),
    'leave', '67.3: no declined value survives the cutover');
  PERFORM test_support.assert_true(
    (SELECT status FROM leave_requests WHERE reason = 'Flu') = 'rejected',
    'leave', '67.3: declined renames to rejected (D2)');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'leave_requests'
                   AND column_name IN ('days', 'person')),
    'leave', '67.3: the stored days count and legacy person link are dropped');
  PERFORM test_support.assert_true(
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'leave_requests'
        AND column_name = 'requester_user') = 'NO',
    'leave', '67.3: requester_user is NOT NULL');
  PERFORM test_support.assert_true(
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'leave_requests'
        AND column_name = 'branch') = 'NO',
    'leave', '67.3: branch is NOT NULL');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint WHERE conname IN (
      'leave_requests_dates_ordered',
      'leave_requests_decision_stamped_together',
      'leave_requests_type_allowed',
      'leave_requests_status_allowed',
      'leave_requests_reason_nonblank',
      'leave_request_events_type_allowed')) = 6,
    'leave', '67.3: the six audited CHECKs hold under their FIXED names');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_request_events WHERE event_type = 'created') = 6,
    'leave', '67.3: one created audit row is backfilled per request');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_request_events WHERE detail LIKE 'cutover 0067 (D1)%') = 1,
    'leave', '67.3: the maternity conversion carries an audit note (D1)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_request_events WHERE detail LIKE 'cutover 0067 (D2)%') = 1,
    'leave', '67.3: the declined rename carries an audit note (D2)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO leave_request_events (leave_request, event_type) VALUES ((SELECT id FROM leave_requests LIMIT 1), ''archived'')',
    '23514', 'leave', '67.3: the audit trail keeps its closed event set');
END $$;

-- ---------------------------------------------------------------------------
-- 67.4  GRANTS. Column-level INSERT/UPDATE over the exact operational
--         sets; no DELETE anywhere (audited facts); PUBLIC holds nothing.
--         has_table_privilege is ANY-matching on a comma list (a single
--         table-level grant satisfies it), so the column sets are pinned
--         through information_schema instead.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_insert text[];
  v_update text[];
  v_events_insert text[];
  v_events_update text[];
BEGIN
  SELECT coalesce(array_agg(column_name ORDER BY column_name), '{}') INTO v_insert
    FROM information_schema.role_column_grants
   WHERE table_schema = 'public' AND table_name = 'leave_requests'
     AND grantee = 'directus_app' AND privilege_type = 'INSERT';
  SELECT coalesce(array_agg(column_name ORDER BY column_name), '{}') INTO v_update
    FROM information_schema.role_column_grants
   WHERE table_schema = 'public' AND table_name = 'leave_requests'
     AND grantee = 'directus_app' AND privilege_type = 'UPDATE';

  PERFORM test_support.assert_true(
    v_insert = ARRAY['branch','created_by','decided_at','decided_by','end_date','leave_type','reason','requester_person','requester_user','start_date','status','zone'],
    'leave', '67.4: app INSERTs exactly the operational columns (no days/person, no DELETE path)');
  PERFORM test_support.assert_true(
    v_update = ARRAY['decided_at','decided_by','end_date','leave_type','reason','requester_person','start_date','status','zone'],
    'leave', '67.4: app UPDATEs exactly the correctable columns');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                 WHERE table_schema = 'public' AND table_name = 'leave_requests'
                   AND grantee = 'directus_app' AND privilege_type = 'DELETE')
    AND NOT EXISTS (SELECT 1 FROM information_schema.role_column_grants
                     WHERE table_schema = 'public' AND table_name = 'leave_requests'
                       AND grantee = 'directus_app' AND privilege_type = 'DELETE'),
    'leave', '67.4: app holds no DELETE on leave_requests (audited facts)');

  SELECT coalesce(array_agg(column_name ORDER BY column_name), '{}') INTO v_events_insert
    FROM information_schema.role_column_grants
   WHERE table_schema = 'public' AND table_name = 'leave_request_events'
     AND grantee = 'directus_app' AND privilege_type = 'INSERT';
  SELECT coalesce(array_agg(column_name ORDER BY column_name), '{}') INTO v_events_update
    FROM information_schema.role_column_grants
   WHERE table_schema = 'public' AND table_name = 'leave_request_events'
     AND grantee = 'directus_app' AND privilege_type = 'UPDATE';
  PERFORM test_support.assert_true(
    v_events_insert = ARRAY['actor_user','created_at','detail','event_type','leave_request']
    AND v_events_update = ARRAY['detail'],
    'leave', '67.4: app appends audit rows and touches nothing else on the trail');
  PERFORM test_support.assert_true(
    NOT has_table_privilege('directus_app', 'public.leave_request_events', 'DELETE'),
    'leave', '67.4: app holds no DELETE on the audit trail');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_requests', 'SELECT')
    AND has_table_privilege('directus_app', 'public.leave_request_events', 'SELECT'),
    'leave', '67.4: app reads the cut register and its trail');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name IN ('leave_requests', 'leave_request_events')
        AND grantee = 'PUBLIC') = 0,
    'leave', '67.4: PUBLIC holds nothing on the cut register or its trail');
END $$;

-- ---------------------------------------------------------------------------
-- 67.5  RERUN. Re-applying 0067 changes nothing (idempotent forward).
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM leave_requests) = 6
    AND (SELECT count(*) FROM leave_request_events WHERE event_type = 'created') = 6
    AND (SELECT count(*) FROM leave_request_events WHERE event_type = 'note') = 2,
    'leave', '67.5: 0067 re-apply is a no-op (rows, created backfills, notes unchanged)');
END $$;

-- ---------------------------------------------------------------------------
-- 67.6  ROLLBACK. The SHIPPED down script refuses while either table holds
--         rows; emptied, it restores the 0052 shape; re-apply restores 0067.
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
BEGIN
  INSERT INTO leave_requests (requester_user, branch, start_date, end_date, leave_type, reason)
    VALUES ('11111111-1111-1111-1111-111111111111',
            (SELECT id FROM branches WHERE code = 'OKE-ARO'),
            DATE '2026-12-28', DATE '2026-12-29', 'annual', 'Rollback guard');
  BEGIN
\i services/directus/schema/migrations/rollback/20261105_0067_leave_register_cutover.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'leave', '67.6: down refuses while rows exist');
  DELETE FROM leave_requests WHERE id IS NOT NULL AND reason = 'Rollback guard';
END $test$;
RESET ROLE;

DELETE FROM leave_request_events;
DELETE FROM leave_requests;

SET ROLE directus_migrator;
\i services/directus/schema/migrations/rollback/20261105_0067_leave_register_cutover.down.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'leave_requests'
               AND column_name = 'days')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'leave_requests'
                       AND column_name = 'requester_user')
    AND to_regclass('public.leave_request_events') IS NULL,
    'leave', '67.6: down restores the 0052 shape (days back, no requester_user, no trail)');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.leave_requests', 'DELETE'),
    'leave', '67.6: down restores the 0052 DELETE grant');
END $$;

SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.leave_requests') IS NOT NULL
    AND to_regclass('public.leave_request_events') IS NOT NULL
    AND NOT has_table_privilege('directus_app', 'public.leave_requests', 'DELETE'),
    'leave', '67.6: re-apply restores the cut shape with no DELETE grant');
END $$;
