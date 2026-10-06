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
--         and directus_app's surface on the same schema is EXACTLY {} -- the
--         application reaches the engine through nothing at all (AFC-208)
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
-- 64.1b  THE APPLICATION ROLE'S SURFACE ON THE SAME SCHEMA IS EXACTLY {}.
--
-- AFC-208. Why this is the second half of 64.1 and not a curiosity:
--
--   64.1 pins what the WORKER can reach. It says nothing about anybody else, so a
--   grant of any engine function to directus_app keeps every other assertion in
--   this file green. That is not hypothetical. main carried
--   GRANT EXECUTE ON retention.release_hold(...) TO directus_app through 63, 64
--   and 65 all green, and through AFC-249's own new attribution suite as well.
--   65.2 pins directus_app away from retention.run BY NAME; nothing anywhere
--   pinned it away from the schema, which is the only place a grant on a renamed
--   or added function would show up.
--
--   Least privilege is not a floor. Empty is the claim for this role, and empty
--   is only enforceable by set equality against a named list. An "is it absent"
--   check also passes on a query that matched nothing.
--
-- FOUR INDEPENDENT INSTRUMENTS, because the failure mode is a check that reports
-- nothing and reads as clean:
--
--   1. the same aggregate 64.1 uses, over directus_app, compared to empty
--   2. has_function_privilege, asked about specific functions BY NAME, so a red
--      run says which one arrived instead of printing "(none)"
--   3. aclexplode over proacl -- a direct read of the grant list with no
--      privilege function in the query, so it cannot share a bug with 1 or 2
--   4. an actual call, refused by the grant list at runtime
--
-- The positive control is on instrument 1 and it is the strongest form
-- available: the identical query, run against retention_worker, must return
-- run+sync_clocks. A query that can report a grant, and does, cannot be the
-- reason the other role reports none.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_app_surface text[];
  v_expect      text[];
  v_release_oid oid;
  v_run_oid     oid;
  v_acl_leak    text;
BEGIN
  -- Preconditions, so every denial below is a decision and not a typo. If either
  -- function were renamed or dropped this would fail with "does not exist" rather
  -- than quietly passing on an absence that means nothing.
  SELECT p.oid INTO v_release_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention' AND p.proname = 'release_hold';
  SELECT p.oid INTO v_run_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention' AND p.proname = 'run';

  PERFORM test_support.assert_true(v_release_oid IS NOT NULL, 'worker',
    'release_hold exists, so denying it to the application role is a decision and not a typo');

  PERFORM test_support.assert_true(v_run_oid IS NOT NULL, 'worker',
    'run exists, so the erasure entrypoint below is named rather than absent');

  -- Instrument 1. Set equality against the EMPTY set.
  --
  -- nullif before coalesce, and the reason is not cosmetic:
  -- array_to_string(ARRAY[]::text[], ',') returns the EMPTY STRING, not NULL, so a
  -- plain coalesce leaves the expected side as '' and the assertion compares
  -- '(none)' with '' on a tree where the control is working -- a red suite on
  -- correct behaviour.
  v_expect := ARRAY[]::text[];

  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_app_surface
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND has_function_privilege('directus_app', p.oid, 'EXECUTE');

  PERFORM test_support.assert_equals(
    coalesce(nullif(array_to_string(v_app_surface, ','), ''), '(none)'),
    coalesce(nullif(array_to_string(v_expect, ','), ''), '(none)'),
    'worker', 'directus_app EXECUTE surface on the engine is empty: the application reaches the engine through nothing');

  -- The positive control. The SAME query against a role that IS granted: it must
  -- report the two grants that exist. Without it, a typo in the role name or in
  -- nspname produces an empty result on both sides and the assertion above
  -- passes on a tree where directus_app holds everything.
  PERFORM test_support.assert_equals(
    (SELECT coalesce(array_to_string(array_agg(p.proname ORDER BY p.proname), ','), '(none)')
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'
        AND has_function_privilege('retention_worker', p.oid, 'EXECUTE')),
    'run,sync_clocks',
    'worker', 'probe control: the same query reports the worker surface in full, so the empty result above is a fact and not a lookup that matched nothing');

  -- Instrument 2, by name, so a failure says which function arrived.
  PERFORM test_support.assert_true(
    has_function_privilege('directus_app', v_release_oid, 'EXECUTE') IS NOT TRUE,
    'worker', 'directus_app cannot execute release_hold: a forged hold release is the one thing that must stay out of reach');

  PERFORM test_support.assert_true(
    has_function_privilege('directus_app', v_run_oid, 'EXECUTE') IS NOT TRUE,
    'worker', 'and cannot execute run: erasure is not handed to the application role');

  -- Instrument 3. The grant list itself, with no privilege function in the
  -- query. A grant that arrived through a group role would not appear here --
  -- which is why instrument 1 has to be the primary claim and this one is the
  -- cross-check, not the reverse.
  SELECT coalesce(string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname), '(none)') INTO v_acl_leak
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    JOIN pg_roles g ON g.oid = a.grantee
   WHERE n.nspname = 'retention'
     AND g.rolname = 'directus_app'
     AND a.privilege_type = 'EXECUTE';

  PERFORM test_support.assert_equals(v_acl_leak, '(none)',
    'worker', 'and the ACL on every engine function names no directus_app EXECUTE entry either');

  -- Instrument 4. The grant list refusing an actual call. A catalog check says
  -- what the ACL says; this says what the database does. 42501 and not 23001,
  -- because the refusal must be the grant list and not a check inside the
  -- function -- the two are told apart by an operator reading a log.
  --
  -- Run from the runner's session with p_role named, NOT from inside an
  -- impersonated session: a session that has already dropped superuser cannot SET
  -- LOCAL ROLE, and this helper captures a refused switch as the statement's
  -- sqlstate. That trap is AFC-257, and it is why 66 reaches for
  -- SET SESSION AUTHORIZATION where this uses the harness.
  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT retention.release_hold(gen_random_uuid())$q$,
    '42501', 'worker', 'a directus_app session is refused release_hold by the grant list: forging a release is not a thing the application role can do');

  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT retention.run('test:surface:app', 'dry_run')$q$,
    '42501', 'worker', 'and is refused run, so an application-side compromise has no erasure path to reach');
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
      WHERE actor_label = 'test:worker:surface' AND status = 'succeeded'), '1',
    'worker', 'run as retention_worker actually ran: the entrypoint is live, not merely granted');
END $$;