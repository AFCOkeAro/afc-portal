-- tests/db/59_retention_delete_guards.sql
--
-- AFC-295. THE WIDER DELETE ROUTE: THE GUARDS AND THE CAPABILITY BOUND.
--
-- ADR-0004 Part 5 bounded the predefined-role route to blanket DELETE
-- (pg_write_all_data) and left the wider route open. The independent review
-- (AFC-291, finding F3) measured that the route is genuinely open: a
-- non-superuser LOGIN holding DELETE on a collection -- via a custom group role
-- or a direct table grant -- can DELETE FROM people, around an active legal hold
-- (legal_holds.scope_id is polymorphic text, not a foreign key to people), and
-- can remove retention_clocks first so the ladder never runs.
--
-- The closure is two layers (engine/0001_retention_engine.sql section 8):
--
--   8a. per-table BEFORE DELETE and BEFORE TRUNCATE guards on the five
--       collections that carried none;
--   8b. a deploy-time capability assertion that no non-superuser LOGIN holds
--       DELETE or TRUNCATE on ANY retention-managed collection.
--
-- WHY THIS SUITE IS NUMBERED 59, BEFORE THE RETENTION SUITES AND BEFORE 63.
--   The deploy predicate (8b) is over every non-superuser LOGIN role. Suite 63
--   deliberately grants DELETE and TRUNCATE on retention_clocks, retention_policies
--   and the rest to the v4 fixture roles, to exercise the state guards. After that
--   grant the predicate is legitimately non-empty for scaffolding reasons, so the
--   clean-tree answer is only observable before it. 59 runs before 63, so it can
--   assert the clean-tree answer AND manufacture the drift. The engine asserts the
--   deployed state where the fixtures do not exist at all; this suite proves the
--   predicate and the guards can both FAIL.
--
-- WHAT IS ASSERTED
--   59.1  the guard function and both triggers exist on each of the five
--         collections -- a bound over a table that is not there is a bound over
--         nothing
--   59.2  the deploy predicate is NULL on the clean tree (no fixture grants yet)
--   59.3  NEGATIVE CONTROL: a LOGIN granted DELETE and TRUNCATE is reported by the
--         deploy predicate, and the DELETE and TRUNCATE guards refuse it with
--         23001 -- the control, not the grant list
--   59.4  the DELETE guard is attached to EVERY collection, not just the one the
--         finding named, and the TRUNCATE guard is exercised where plain
--         TRUNCATE reaches it
--   59.5  the owner exception is real: the engine owner may still delete, so the
--         guard is a guard and not a broken table

-- ---------------------------------------------------------------------------
-- 59.1 + 59.2  THE GUARDS EXIST, AND THE CLEAN-TREE BOUND HOLDS.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'people', 'retention_anchor_sources', 'retention_class_sources',
    'retention_clocks', 'retention_policies'
  ];
  v_all text[] := ARRAY[
    'people', 'retention_anchor_sources', 'retention_class_sources',
    'retention_clocks', 'retention_policies', 'legal_holds',
    'retention_principals', 'retention_run_items', 'retention_runs'
  ];
  v_missing text;
  t text;
BEGIN
  -- Probe control: the guard function is installed. Without this, a missing
  -- function would make every trigger check below report "no trigger".
  PERFORM test_support.assert_true(
    to_regprocedure('public.retention_managed_collection_guard()') IS NOT NULL,
    'delete-guard', 'probe control: the runtime guard function is installed');

  -- Probe control: every collection the bound names exists. A predicate over a
  -- table that is not there matches nothing.
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_missing
    FROM unnest(v_all) AS x
   WHERE to_regclass('public.' || x) IS NULL;
  PERFORM test_support.assert_equals(coalesce(v_missing, '(none)'), '(none)',
    'delete-guard', 'probe control: every retention-managed collection named by the bound exists');

  FOREACH t IN ARRAY v_tables LOOP
    PERFORM test_support.assert_true(
      EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = t || '_no_delete'
                 AND tgrelid = ('public.' || t)::regclass
                 AND NOT tgisinternal),
      'delete-guard', format('probe control: %s carries the DELETE guard trigger', t));
    PERFORM test_support.assert_true(
      EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = t || '_no_truncate'
                 AND tgrelid = ('public.' || t)::regclass
                 AND NOT tgisinternal),
      'delete-guard', format('probe control: %s carries the TRUNCATE guard trigger', t));
  END LOOP;

  -- 59.2. The clean-tree answer. This suite runs before 63 grants DELETE to the
  -- fixture roles, so here the predicate must be empty -- and that is a
  -- measurement, not a constant, because 59.3 below makes it non-empty.
  PERFORM test_support.assert_equals(
    coalesce(retention.unbounded_delete_logins(), '(none)'), '(none)',
    'delete-guard', 'deploy predicate: no non-superuser LOGIN holds DELETE or TRUNCATE on a retention-managed collection on the clean tree');
END $$;

-- ---------------------------------------------------------------------------
-- 59.3  THE NEGATIVE CONTROL. THE DRIFT IS MANUFACTURED AND BOTH LAYERS MUST
--       NOTICE IT.
--
-- A predicate that answers "none" for every input cannot be told apart, from
-- inside the suite, from a boundary that holds. So a plain LOGIN is granted
-- DELETE and TRUNCATE -- the exact shape the finding measured -- and the deploy
-- predicate is required to report it and the runtime guards are required to
-- refuse it. The positive control on has_table_privilege is what makes the 23001
-- refusals meaningful: the credential genuinely holds the privilege, so the
-- refusal is the trigger and not the grant list.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  CREATE ROLE afc59_delete_login LOGIN;

  -- The drift: a direct table grant of the two destructive privileges.
  GRANT SELECT, DELETE, TRUNCATE ON people TO afc59_delete_login;

  -- The capability is real, so the refusals below are the control's doing.
  PERFORM test_support.assert_true(
    has_table_privilege('afc59_delete_login', 'people', 'DELETE')
    AND has_table_privilege('afc59_delete_login', 'people', 'TRUNCATE'),
    'delete-guard', 'control: the manufactured LOGIN genuinely holds DELETE and TRUNCATE on people, so the refusals below are the trigger and not the grant list');

  -- The deploy predicate must report it. Asserted as membership, not as equality:
  -- the predicate is over every LOGIN, and a fixture grant added between this
  -- suite and 63 would only add names, not remove this one.
  SELECT retention.unbounded_delete_logins() INTO v_bad;
  PERFORM test_support.assert_true(
    position('afc59_delete_login:people:DELETE' in coalesce(v_bad, '')) > 0
    AND position('afc59_delete_login:people:TRUNCATE' in coalesce(v_bad, '')) > 0,
    'delete-guard', format('negative control: the deploy predicate reports the manufactured credential (got: %s)', coalesce(v_bad, '(none)')));

  -- And the deploy ASSERTION -- the exact function the engine calls at install
  -- time -- must refuse to certify this cluster. This is what makes the engine's
  -- assertion a control and not a constant with a query in front of it.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT retention.assert_no_login_delete_surface()$q$,
    '23001', 'delete-guard', 'negative control: the deploy assertion itself raises on the manufactured drift, so the engine install would refuse this cluster');

  -- The runtime DELETE guard must refuse the act. A row-level BEFORE DELETE
  -- trigger fires only for a row that exists, so a probe person is inserted
  -- first; the probe discards its subtransaction, so nothing is actually erased.
  INSERT INTO people (id, status)
    VALUES ('00000000-0000-0000-0000-00000000a595'::uuid, 'active');

  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$DELETE FROM people WHERE id = '00000000-0000-0000-0000-00000000a595'::uuid$q$,
    '23001', 'delete-guard', 'negative control: the DELETE guard refuses a granted non-owner -- 23001, the trigger, not 42501');
END $$;

-- ---------------------------------------------------------------------------
-- 59.4  THE GUARD IS ON EVERY COLLECTION, AND TRUNCATE IS CLOSED.
--
-- The finding named `people`. A guard attached to only that table would leave
-- the route open on the four the ladder and the schedule live in. So a probe row
-- is inserted into each collection and the DELETE guard is required to refuse it
-- on every one. Probe rows are removed as the owner afterwards, so the suites
-- after this one see the population they expect.
--
-- TRUNCATE is asserted on the two collections with no foreign-key referent
-- (retention_class_sources, retention_clocks), because plain TRUNCATE of a
-- table a foreign key references is refused by PostgreSQL itself (0A000) before
-- any trigger runs. The TRUNCATE triggers on the other three are pinned by the
-- existence probe in 59.1.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid := '00000000-0000-0000-0000-00000000a595';
  v_policy uuid;
BEGIN
  -- Grant the destructive privileges on the other collections. The drift is
  -- deliberate. The four already-DELETE-guarded collections get TRUNCATE too, so
  -- the statement trigger added for them (F1 of the AFC-298 review) is exercised.
  PERFORM test_support.as_role(NULL,
    $q$GRANT SELECT, DELETE, TRUNCATE ON retention_anchor_sources, retention_class_sources, retention_clocks, retention_policies, legal_holds, retention_principals, retention_run_items, retention_runs TO afc59_delete_login$q$);

  INSERT INTO retention_anchor_sources (anchor_key, table_name, column_name)
    VALUES ('afc59_probe_anchor', 'people', 'date_of_birth');
  INSERT INTO retention_class_sources (retention_class, table_name, person_column)
    VALUES ('afc59_probe_class', 'afc59_probe_table', 'person_id');
  INSERT INTO retention_policies (rule_key, retention_class, version, effective_from, anchor_a, floor_years, operator)
    VALUES ('afc59_probe_rule', 'afc59_probe_class', 1, now(), 'afc59_probe_anchor', 1, 'whichever_later')
    RETURNING id INTO v_policy;
  INSERT INTO retention_clocks (person_id, retention_class, policy_id, policy_version, state)
    VALUES (v_person, 'afc59_probe_class', v_policy, 1, 'live');

  -- DELETE is refused on each collection, by the trigger.
  PERFORM test_support.assert_raises('afc59_delete_login',
    format($q$DELETE FROM retention_anchor_sources WHERE anchor_key = %L$q$, 'afc59_probe_anchor'),
    '23001', 'delete-guard', 'the DELETE guard is attached to retention_anchor_sources');
  PERFORM test_support.assert_raises('afc59_delete_login',
    format($q$DELETE FROM retention_class_sources WHERE retention_class = %L$q$, 'afc59_probe_class'),
    '23001', 'delete-guard', 'the DELETE guard is attached to retention_class_sources');
  PERFORM test_support.assert_raises('afc59_delete_login',
    format($q$DELETE FROM retention_policies WHERE rule_key = %L$q$, 'afc59_probe_rule'),
    '23001', 'delete-guard', 'the DELETE guard is attached to retention_policies');
  PERFORM test_support.assert_raises('afc59_delete_login',
    format($q$DELETE FROM retention_clocks WHERE person_id = %L::uuid$q$, v_person),
    '23001', 'delete-guard', 'the DELETE guard is attached to retention_clocks');

  -- TRUNCATE, where plain TRUNCATE reaches the statement trigger.
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE retention_class_sources$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard is attached to retention_class_sources and closes a hole no row-level guard can reach');
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE retention_clocks$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard is attached to retention_clocks');

  -- F1 of the AFC-298 review. The four collections that carried a DELETE guard and
  -- no TRUNCATE guard. The runtime TRUNCATE guard must cover all nine, not five.
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE legal_holds$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard covers legal_holds, which carried a DELETE guard and no TRUNCATE guard');
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE retention_principals$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard covers retention_principals');
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE retention_run_items$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard covers retention_run_items');
  -- retention_runs is referenced by retention_run_items.run_id, so plain TRUNCATE
  -- is refused by PostgreSQL (0A000) before any trigger; CASCADE reaches it, and
  -- the trigger is what refuses the cascade.
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$TRUNCATE retention_runs CASCADE$q$,
    '23001', 'delete-guard', 'the TRUNCATE guard covers retention_runs, including the CASCADE route a foreign key leaves open');

  -- TRUNCATE is refused for EVERY identity, including the owner: no path truncates a
  -- retention-managed collection, and the verb bypasses row triggers. This is the
  -- deliberate difference from DELETE, which the owner may still perform.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$TRUNCATE retention_clocks$q$,
    '23001', 'delete-guard', 'the owner is refused TRUNCATE too: it is unconditional, unlike DELETE');

  -- Clean up the probe rows as the OWNER, because the guard now refuses everyone
  -- else -- including the session superuser, which must SET ROLE to the owner
  -- deliberately, exactly as incidents_no_delete requires. Deleted in FK order.
  PERFORM test_support.as_role('directus_migrator',
    format($q$DELETE FROM retention_clocks WHERE person_id = %L::uuid$q$, v_person));
  PERFORM test_support.as_role('directus_migrator',
    $q$DELETE FROM retention_policies WHERE rule_key = 'afc59_probe_rule'$q$);
  PERFORM test_support.as_role('directus_migrator',
    $q$DELETE FROM retention_class_sources WHERE retention_class = 'afc59_probe_class'$q$);
  PERFORM test_support.as_role('directus_migrator',
    $q$DELETE FROM retention_anchor_sources WHERE anchor_key = 'afc59_probe_anchor'$q$);
  PERFORM test_support.as_role('directus_migrator',
    format($q$DELETE FROM people WHERE id = %L::uuid$q$, v_person));
  PERFORM test_support.as_role(NULL, $q$SELECT 1$q$);   -- restore the session role

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM people WHERE id = v_person), '0',
    'delete-guard', 'cleanup: the probe rows were removed by the owner, so the suites after this one see the population they expect');
END $$;

-- ---------------------------------------------------------------------------
-- 59.5  THE OWNER EXCEPTION IS REAL.
--
-- A guard that refuses everyone is a broken table, not a control: the engine's
-- own erasure path is a SECURITY DEFINER function owned by directus_migrator, and
-- a future person-erasure path will delete rows the same way. So the owner branch
-- is exercised, on a throwaway table carrying the same function, so no real
-- collection is mutated. Both directions of the predicate are asserted.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TABLE afc59_guard_probe (id integer);
  CREATE TRIGGER afc59_guard_probe_no_delete
    BEFORE DELETE ON afc59_guard_probe
    FOR EACH ROW EXECUTE FUNCTION public.retention_managed_collection_guard();
  INSERT INTO afc59_guard_probe VALUES (1);

  -- The owner may delete. The grant is needed because the probe table was
  -- created by the session role, so directus_migrator owns nothing here and the
  -- grant list would answer 42501 before the trigger; the point of the control is
  -- the trigger's owner branch, so the grant is made and the branch is reached.
  GRANT SELECT, DELETE ON afc59_guard_probe TO directus_migrator;
  -- probe() discards its subtransaction, so the row stays for the refusal below.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$DELETE FROM afc59_guard_probe$q$,
    'delete-guard', 'the guard allows the engine owner: it is a guard, not a table that cannot be written');

  -- A non-owner holding DELETE may not.
  GRANT SELECT, DELETE ON afc59_guard_probe TO afc59_delete_login;
  PERFORM test_support.assert_raises('afc59_delete_login',
    $q$DELETE FROM afc59_guard_probe$q$,
    '23001', 'delete-guard', 'and refuses a non-owner on the same table, so the owner branch is an exception and not a missing guard');

  DROP TABLE afc59_guard_probe;
END $$;

-- ---------------------------------------------------------------------------
-- TEARDOWN AND THE CLEAN-TREE RESTORATION.
--
-- The suite must leave the cluster as it found it: the manufactured credential
-- gone, and the deploy predicate back to the clean-tree answer. Without this,
-- the deploy assertion would start failing for anything that runs after this.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  REVOKE ALL PRIVILEGES ON people, retention_anchor_sources, retention_class_sources,
                            retention_clocks, retention_policies, legal_holds,
                            retention_principals, retention_run_items, retention_runs
    FROM afc59_delete_login;
  DROP ROLE afc59_delete_login;

  -- O1 of the AFC-298 review. has_table_privilege respects INHERIT, so a LOGIN
  -- granted directus_migrator WITH INHERIT FALSE, SET TRUE is not reported by
  -- unbounded_delete_logins(), yet can SET ROLE directus_migrator and erase. The
  -- deploy assertion must refuse it directly, not only via bootstrap's route 3.
  CREATE ROLE afc59_owner_login LOGIN;
  GRANT directus_migrator TO afc59_owner_login WITH INHERIT FALSE, SET TRUE;

  PERFORM test_support.assert_equals(
    coalesce(retention.unbounded_delete_logins(), '(none)'), '(none)',
    'delete-guard', 'control: the table-privilege predicate does NOT report an INHERIT-FALSE owner membership, so the assertion below is about the second arm and not a table grant');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT retention.assert_no_login_delete_surface()$q$,
    '23001', 'delete-guard', 'the deploy assertion refuses a LOGIN member of the engine owner even with INHERIT FALSE -- the INHERIT-agnostic arm, the bootstrap route-3 equivalent');

  REVOKE directus_migrator FROM afc59_owner_login;
  DROP ROLE afc59_owner_login;

  PERFORM test_support.assert_equals(
    coalesce(retention.unbounded_delete_logins(), '(none)'), '(none)',
    'delete-guard', 'cleanup: the manufactured credential is gone and the deploy predicate is back to none');
END $$;
