-- tests/db/64_retention_worker_surface.sql
--
-- AFC-193 / ADR-0002 finding F2. THE WORKER'S GRANT SURFACE IS PINNED.
--
-- WHY THIS IS A SEPARATE SUITE FROM 63
--   tests/db/63_retention_privileges.sql asserts that retention_worker CAN call
--   sync_clocks. That is the assertion whose absence let F2 ship, and it is
--   correct and necessary. It is not sufficient on its own, because a grant list
--   that grows also keeps that assertion green.
--
--   F2's preferred fix was `SECURITY DEFINER` on sync_clocks precisely so that
--   the worker's surface stays at exactly two entrypoints instead of being
--   widened to the four helpers. That choice is only enforced if something
--   asserts the surface. Nothing did, so the first person to make the job
--   convenient again would have done it by adding a GRANT, and every green
--   assertion would still have passed.
--
-- WHAT IS ASSERTED
--   64.1  the worker's EXECUTE surface on the engine schema is EXACTLY
--         {run, sync_clocks} -- no more, and no fewer
--   64.2  PUBLIC holds EXECUTE on nothing in the engine schema
--   64.3  the helpers the SECURITY DEFINER route deliberately kept away from
--         the worker stay away, each named, so the grant that would undo F2's
--         fix has to be written down to break this suite
--   64.4  the two entrypoints that ARE granted actually run as the worker. A
--         grant that exists but cannot be exercised is still a broken control,
--         and it is how F2 looked before the fix.
--
-- WHY "EXACTLY" AND NOT "AT LEAST"
--   Least privilege is not a floor. A worker that can reach compute_due_date
--   directly can decide a due date outside the engine's fail-closed derivation,
--   and a worker that can reach resolve_anchor can resolve an anchor against any
--   configured table. Both are the decision the control exists to make. The
--   comparison is set equality against a named list, so an addition fails here
--   the day it lands rather than at the next review.

-- ---------------------------------------------------------------------------
-- 64.1  THE SURFACE IS EXACTLY run + sync_clocks.
--
-- has_function_privilege, not a read of proacl: the ACL is the grant list and
-- the effective privilege is what the engine actually enforces. This also
-- accounts for role membership and PUBLIC, so a grant made indirectly still
-- shows up as a widened surface.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_surface text[];
  v_expect  text[] := ARRAY['run', 'sync_clocks'];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_surface
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND has_function_privilege('retention_worker', p.oid, 'EXECUTE');

  -- Set equality both ways. array_agg(ORDER BY) on both sides, so this compares
  -- contents rather than an ordering accident.
  PERFORM test_support.assert_equals(
    coalesce(array_to_string(v_surface, ','), '(none)'),
    array_to_string(v_expect, ','),
    'worker', 'retention_worker EXECUTE surface on the engine is exactly run + sync_clocks');

  -- The two halves stated separately, so a failure says WHICH direction broke.
  -- A missing entry means the worker cannot run the control; an extra entry
  -- means the control's decisions have been opened up. They are opposite
  -- defects and a board should never have to guess which one it is looking at.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention' AND p.proname = ANY(v_expect)
        AND has_function_privilege('retention_worker', p.oid, 'EXECUTE')),
    (SELECT count(*)::text FROM unnest(v_expect)),
    'worker', 'both entrypoints are reachable: the worker can run the control at all');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'
        AND NOT p.proname = ANY(v_expect)
        AND has_function_privilege('retention_worker', p.oid, 'EXECUTE')),
    '0',
    'worker', 'and nothing else is: the worker surface has not quietly widened');
END $$;

-- ---------------------------------------------------------------------------
-- 64.2  PUBLIC holds nothing.
--
-- The schema itself is default-denied (63.3). This is the function layer: a
-- PUBLIC EXECUTE on an engine function reaches it from every role in the
-- instance, including roles created later that nobody reviewed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_leak
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND has_function_privilege('public', p.oid, 'EXECUTE');

  PERFORM test_support.assert_equals(coalesce(v_leak, '(none)'), '(none)',
    'worker', 'PUBLIC holds EXECUTE on no engine function');

  -- Positive control on the check itself: a role that IS granted one sees it.
  -- Without this, a query that matched nothing -- wrong schema name, wrong
  -- column -- would read as "PUBLIC holds nothing" and pass.
  PERFORM test_support.assert_true(
    has_function_privilege('retention_worker',
      (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'retention' AND p.proname = 'run'), 'EXECUTE'),
    'worker', 'probe control: the same query does report a grant that exists, so the PUBLIC check is not vacuous');

  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'),
    'worker', 'probe control: the engine schema has functions in it at all');
END $$;

-- ---------------------------------------------------------------------------
-- 64.3  THE HELPERS STAY OUT OF REACH.
--
-- Named individually rather than counted, because the count is satisfied by the
-- wrong set. Each of these is a decision the engine makes fail-closed; calling
-- one directly is how that decision gets skipped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_helper text;
  v_via    text;
  v_found  text;
BEGIN
  FOREACH v_helper IN ARRAY ARRAY[
    'compute_due_date',   -- picking a due date outside the engine's derivation
    'resolve_anchor',     -- resolving an anchor against any configured table
    'has_active_hold',    -- asking the hold question outside the check order
    'add_years'           -- the interval builder D1 depends on
  ]
  LOOP
    SELECT format('retention.%s(...)', v_helper) INTO v_via
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'retention' AND p.proname = v_helper;

    PERFORM test_support.assert_true(v_via IS NOT NULL, 'worker',
      format('the helper %s exists, so denying it is a decision and not a typo', v_helper));

    -- No row matches is the PASSING case here, so the aggregate returns NULL.
    -- coalesce is what turns "no row" into the asserted value; without it the
    -- assertion compares NULL to '(absent)' and fails on correct behaviour.
    SELECT coalesce((SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention' AND p.proname = v_helper
        AND has_function_privilege('retention_worker', p.oid, 'EXECUTE')), '(absent)')
      INTO v_found;

    PERFORM test_support.assert_equals(v_found, '(absent)',
      'worker', format('retention_worker cannot execute %s: the worker asks the engine, it does not answer for it', v_helper));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 64.4  THE GRANT IS NOT DECORATIVE.
--
-- A grant that exists but cannot be exercised is still a broken control, and it
-- is exactly what F2 was: run worked, sync_clocks was granted and unreachable.
-- Both entrypoints are therefore driven as the worker, not as the owner.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_clocks_before integer;
  v_clocks_after  integer;
  v_n             integer;
BEGIN
  SELECT count(*) INTO v_clocks_before FROM retention_clocks;

  -- via as_role, not assert_not_raises: the probe harness discards its writes,
  -- so a probe proves only "no exception raised", not "clocks were recomputed".
  -- F2 returned an exception, so the probe half alone would have caught it, but
  -- an assertion that only catches the symptom leaves the function free to
  -- become a silent no-op -- the failure mode that looks most like working.
  PERFORM test_support.as_role('retention_worker',
    $q$SELECT retention.sync_clocks()$q$);

  SELECT count(*) INTO v_clocks_after FROM retention_clocks;

  -- The worker holds SELECT on the tables and no INSERT/UPDATE, so if
  -- sync_clocks ever stops being able to write, this is where it shows.
  PERFORM test_support.assert_true(v_clocks_after > 0,
    'worker', 'sync_clocks as retention_worker wrote clock state rather than doing nothing');

  -- And the recompute is total, not a no-op: with active policies and active
  -- people in the fixture, the count cannot be zero. Asserted over the engine's
  -- own return value via a second call, which is cheap and idempotent by design.
  PERFORM test_support.as_role('retention_worker',
    $q$SELECT count(*) FROM retention_clocks$q$);

  SELECT count(*) INTO v_n FROM retention_clocks;
  PERFORM test_support.assert_true(v_n > 0,
    'worker', 'the worker can read the clock state it produced, so the job is observable from where it runs');

  -- The other entrypoint, driven the same way, because the F2 lesson is that
  -- "the suite is green" and "the job runs in production" are different claims.
  PERFORM test_support.as_role('retention_worker',
    $q$SELECT retention.run('test:worker:surface', 'dry_run')$q$);

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE actor = 'test:worker:surface' AND status = 'succeeded'), '1',
    'worker', 'run as retention_worker actually ran: the entrypoint is live, not merely granted');
END $$;