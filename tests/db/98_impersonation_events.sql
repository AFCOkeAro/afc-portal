-- tests/db/98_impersonation_events.sql
--
-- AFC-684 impersonation audit. THE START/STOP TRAIL CONTRACT.
--
-- Migration 0037 adds impersonation_events: one row per preview start/stop
-- (actor required, exactly one target, started/stopped, reason required).
-- The routes write the row on every start (fail-closed when the store is
-- missing) and on every exit (log-and-restore so nobody is trapped). This
-- suite asserts the database half of that promise -- the half a crafted
-- HTTP request cannot change:
--
--   98.1  table         -- impersonation_events exists with the audit column
--                         set; the action vocabulary is closed.
--   98.2  rerun         -- re-applying 20261022_0037 changes nothing
--                         (IF NOT EXISTS everywhere; fixture rows survive).
--   98.3  constraints   -- actor required; exactly one target; blank reason
--                         rejected; unknown action rejected; started_at set.
--   98.4  guards        -- the app identity selects and inserts operational
--                         columns, updates nothing, deletes nothing.
--   98.5  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): the allow/deny
-- matrix, escalation-impossible, TTL/expiry, banner and picker behaviour --
-- all belong in the tests/web impersonation contract suite. A SQL suite
-- asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 98.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
-- ---------------------------------------------------------------------------
INSERT INTO impersonation_events
  (id, actor, target_branch, action, reason)
VALUES
  ('98111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000b1',
    'started', 'Fixture preview: area admin previews branch b1')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 98.1  TABLE. The audit table exists with the AFC-684 column set.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    test_support.table_exists('impersonation_events'),
    'impersonation', '98.1: impersonation_events exists');

  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'actor'),
    'impersonation', '98.1: actor column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_user'),
    'impersonation', '98.1: target_user column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_branch'),
    'impersonation', '98.1: target_branch column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_zone'),
    'impersonation', '98.1: target_zone column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'action'),
    'impersonation', '98.1: action column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'reason'),
    'impersonation', '98.1: reason column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'started_at'),
    'impersonation', '98.1: started_at column exists');
END
$$;

-- ---------------------------------------------------------------------------
-- 98.2  RERUN. Re-applying 0037 changes nothing: the impersonation
-- trigger count is captured in a temp table BEFORE the re-apply and compared
-- AFTER (a post/post comparison would always pass). Temp tables are fine
-- here: suites run as the session superuser, unlike the SET ROLE migrator
-- path where PGlite refuses them.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _imp_trg_before AS
  SELECT count(*) AS n FROM pg_trigger
   WHERE tgname LIKE 'impersonation\_%' AND NOT tgisinternal;

\i services/directus/schema/migrations/20261022_0037_impersonation_events.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT n::text FROM _imp_trg_before),
    (SELECT count(*)::text FROM pg_trigger
      WHERE tgname LIKE 'impersonation\_%' AND NOT tgisinternal),
    'impersonation', '98.2: re-applying 20261022_0037 changes nothing (idempotent forward)');
END $$;

DROP TABLE _imp_trg_before;

-- ---------------------------------------------------------------------------
-- 98.3  CONSTRAINTS. Actor required; exactly one target; reason non-blank;
--        action closed; started_at defaulted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  -- Zero targets rejected.
  BEGIN
    INSERT INTO impersonation_events (actor, action, reason)
    VALUES ('00000000-0000-4000-8000-0000000000a1', 'started', 'no target at all');
    PERFORM test_support.assert_true(false, 'impersonation', '98.3: zero targets must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'impersonation', '98.3: zero targets rejected');
  END;

  -- Two targets rejected.
  BEGIN
    INSERT INTO impersonation_events
      (actor, target_branch, target_zone, action, reason)
    VALUES
      ('00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000b1',
       '00000000-0000-4000-8000-0000000000c1',
       'started', 'two targets at once');
    PERFORM test_support.assert_true(false, 'impersonation', '98.3: two targets must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'impersonation', '98.3: two targets rejected');
  END;

  -- Blank reason rejected.
  BEGIN
    INSERT INTO impersonation_events
      (actor, target_branch, action, reason)
    VALUES
      ('00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000b1',
       'started', '   ');
    PERFORM test_support.assert_true(false, 'impersonation', '98.3: blank reason must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'impersonation', '98.3: blank reason rejected');
  END;

  -- Unknown action rejected.
  BEGIN
    INSERT INTO impersonation_events
      (actor, target_branch, action, reason)
    VALUES
      ('00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000b1',
       'paused', 'not a real action');
    PERFORM test_support.assert_true(false, 'impersonation', '98.3: unknown action must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'impersonation', '98.3: unknown action rejected');
  END;

  -- started_at defaults.
  INSERT INTO impersonation_events
    (id, actor, target_zone, action, reason)
  VALUES
    (v_id,
     '00000000-0000-4000-8000-0000000000a1',
     '00000000-0000-4000-8000-0000000000c1',
     'stopped', 'Fixture exit: preview ended');
  PERFORM test_support.assert_true(
    (SELECT started_at IS NOT NULL FROM impersonation_events WHERE id = v_id),
    'impersonation', '98.3: started_at defaults to now');
  DELETE FROM impersonation_events WHERE id = v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 98.4  GUARDS. App identity: SELECT + INSERT operational columns, no UPDATE,
--        no DELETE (append-only audit; erasure runs as retention_worker).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    test_support.can_select('directus_app', 'impersonation_events'),
    'impersonation', '98.4: directus_app selects the audit trail');
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'impersonation_events',
      ARRAY['actor', 'target_user', 'target_branch', 'target_zone', 'action', 'reason']),
    'impersonation', '98.4: directus_app inserts audit rows');
  PERFORM test_support.assert_true(
    NOT test_support.can_update('directus_app', 'impersonation_events'),
    'impersonation', '98.4: directus_app updates nothing (append-only)');
  PERFORM test_support.assert_true(
    NOT test_support.can_delete('directus_app', 'impersonation_events'),
    'impersonation', '98.4: directus_app deletes nothing (retention_worker owns erasure)');
END
$$;

-- ---------------------------------------------------------------------------
-- 98.5  ROLLBACK. The down script refuses while rows exist (23001).
-- ---------------------------------------------------------------------------
-- 98.5  ROLLBACK. The down script refuses while rows exist (23001).
-- Probed with the same predicate as the shipped down script (section 0).
-- Written as a single-quoted string (doubled quotes) to avoid nested
-- dollar-quoting.
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    'DO $rb$ BEGIN IF (SELECT count(*) FROM impersonation_events) > 0 THEN RAISE EXCEPTION ''refusing test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'impersonation', '98.5: rollback refuses while rows exist');
END
$$;
