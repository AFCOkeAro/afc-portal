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
    '98.1: impersonation_events exists');

  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'actor'),
    '98.1: actor column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_user'),
    '98.1: target_user column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_branch'),
    '98.1: target_branch column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'target_zone'),
    '98.1: target_zone column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'action'),
    '98.1: action column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'reason'),
    '98.1: reason column exists');
  PERFORM test_support.assert_true(
    test_support.column_exists('impersonation_events', 'started_at'),
    '98.1: started_at column exists');
END
$$;

-- ---------------------------------------------------------------------------
-- 98.2  RERUN. Re-applying 0037 changes nothing.
-- ---------------------------------------------------------------------------
SELECT test_support.assert_migration_rerun_clean('20261022_0037');

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
    PERFORM test_support.assert_true(false, '98.3: zero targets must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, '98.3: zero targets rejected');
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
    PERFORM test_support.assert_true(false, '98.3: two targets must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, '98.3: two targets rejected');
  END;

  -- Blank reason rejected.
  BEGIN
    INSERT INTO impersonation_events
      (actor, target_branch, action, reason)
    VALUES
      ('00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000b1',
       'started', '   ');
    PERFORM test_support.assert_true(false, '98.3: blank reason must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, '98.3: blank reason rejected');
  END;

  -- Unknown action rejected.
  BEGIN
    INSERT INTO impersonation_events
      (actor, target_branch, action, reason)
    VALUES
      ('00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000b1',
       'paused', 'not a real action');
    PERFORM test_support.assert_true(false, '98.3: unknown action must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, '98.3: unknown action rejected');
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
    '98.3: started_at defaults to now');
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
    '98.4: directus_app selects the audit trail');
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'impersonation_events',
      ARRAY['actor', 'target_user', 'target_branch', 'target_zone', 'action', 'reason']),
    '98.4: directus_app inserts audit rows');
  PERFORM test_support.assert_true(
    NOT test_support.can_update('directus_app', 'impersonation_events'),
    '98.4: directus_app updates nothing (append-only)');
  PERFORM test_support.assert_true(
    NOT test_support.can_delete('directus_app', 'impersonation_events'),
    '98.4: directus_app deletes nothing (retention_worker owns erasure)');
END
$$;

-- ---------------------------------------------------------------------------
-- 98.5  ROLLBACK. The down script refuses while rows exist (23001).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM test_support.apply_rollback('20261022_0037');
    PERFORM test_support.assert_true(false, '98.5: rollback must refuse while rows exist');
  EXCEPTION WHEN restrict_violation THEN
    PERFORM test_support.assert_true(true, '98.5: rollback refuses while rows exist');
  END;
END
$$;
