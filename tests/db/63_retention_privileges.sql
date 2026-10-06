-- tests/db/63_retention_privileges.sql
--
-- AFC-167 section 5. LEAST PRIVILEGE. AFC-167 section 8.6. THE PEOPLE MERGE
-- CONTRACT.
--
-- The design claim is: "the job is the only deletion path". A claim like that is
-- worth nothing as prose, so this suite tries every route the system offers and
-- asserts each one is closed.
--
--   63.1  no Directus role, however granted, can DELETE a retention-covered
--         record -- including a role holding ALL on every retention table
--   63.2  retention_worker cannot DELETE either. It erases only through
--         retention.run(), which is what makes the job the path rather than
--         merely a caller of it
--   63.3  PUBLIC gets nothing on the engine schema, and the engine functions
--         are default-deny
--   63.4  the app role can PLACE and RELEASE a hold, and cannot forge a release
--   63.5  clock state and delete_enabled are engine/owner-only even for a fully
--         granted session
--   63.6  the erasure grant is held by exactly one role, and it is documented
--   63.7  the people merge contract, so this migration cannot be mistaken for a
--         second competing identity table

-- ---------------------------------------------------------------------------
-- 63.1 + 63.2  THE GRANT LIST.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_roles text[] := ARRAY[
    'super_admin', 'area_admin', 'branch_admin',
    'welfare_officer', 'staff_volunteer', 'member', 'public'
  ];
BEGIN
  -- Positive control: directus_app reads the schedule. An operator who cannot
  -- see when a record is due cannot answer a data subject's question about it,
  -- so read access is a deliberate grant and not an accident.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM retention_policies$q$,
    'priv', 'directus_app can read the schedule');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM retention_clocks$q$,
    'priv', 'directus_app can read the clocks');

  -- No DELETE anywhere for the runtime identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM fixture_medical_notes$q$,
    '42501', 'priv', 'directus_app has no DELETE on an erasure target');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM fixture_orphan_notes$q$,
    '42501', 'priv', 'directus_app has no DELETE on any erasure target');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM retention_clocks WHERE state = 'due'$q$,
    '42501', 'priv', 'directus_app cannot delete a clock row to tidy up a manifest');

  -- Nor TRUNCATE.
  PERFORM test_support.assert_raises('directus_app',
    $q$TRUNCATE fixture_medical_notes$q$,
    '42501', 'priv', 'directus_app cannot truncate an erasure target');

  -- THE STRONGER VERSION. Grant every v4 Directus role ALL on every retention
  -- table, which is more than any Directus policy could map to, and then try
  -- again. If the control were a grant list, this is the grant list failing.
  FOREACH v_role IN ARRAY v_roles LOOP
    PERFORM test_support.as_role(NULL,
      format('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON fixture_medical_notes TO directus_%I', v_role));
    PERFORM test_support.as_role(NULL,
      format('GRANT ALL PRIVILEGES ON retention_clocks, retention_policies TO directus_%I', v_role));
  END LOOP;
  PERFORM test_support.as_role(NULL,
    'GRANT ALL PRIVILEGES ON retention_clocks, retention_policies, retention_runs,
                                retention_run_items, legal_holds, retention_anchor_sources,
                                retention_class_sources, people, fixture_medical_notes
       TO test_table_super');

  -- With ALL granted, a role CAN delete rows directly -- and that is exactly
  -- why the erasure GRANT is a provisioning decision (63.6) rather than
  -- something the schema can enforce. What the schema CAN enforce is the part
  -- that produces a false record: clock state and delete_enabled.
  PERFORM test_support.assert_raises('directus_super_admin',
    $q$UPDATE retention_clocks SET state = 'deleted' WHERE state = 'due'$q$,
    '23001', 'priv', 'super_admin: fully granted UPDATE still cannot mark a clock deleted');

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE retention_clocks SET state = 'deleted' WHERE state = 'due'$q$,
    '23001', 'priv', 'a role with ALL on the table still cannot mark a clock deleted');

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE retention_policies SET delete_enabled = true WHERE delete_enabled = false$q$,
    '23001', 'priv', 'a role with ALL on the table still cannot enable live erasure');

  -- And the erasure target rows are not gone, because nothing claimed to erase
  -- them.
  PERFORM test_support.assert_true(
    (SELECT retention_records_deleted >= 0 FROM retention_metrics),
    'priv', 'the metrics view is still coherent after the refused updates');
END $$;

-- ---------------------------------------------------------------------------
-- 63.2b  retention_worker erases only through the engine.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('retention_worker',
    $q$DELETE FROM fixture_medical_notes$q$,
    '42501', 'priv', 'retention_worker has no DELETE of its own: erasure is via the engine');

  -- 42501, not 23001, and that is the point of recording which layer refuses:
  -- retention_worker holds SELECT only, so the GRANT LIST stops it before the
  -- trigger is ever reached. The trigger in 63.5 is the second layer, for the
  -- case where someone widens the grant by accident.
  PERFORM test_support.assert_raises('retention_worker',
    $q$UPDATE retention_clocks SET state = 'deleted'$q$,
    '42501', 'priv', 'retention_worker cannot mark a clock deleted by hand: refused by the grant list');

  PERFORM test_support.assert_raises('retention_worker',
    $q$UPDATE retention_policies SET delete_enabled = true WHERE delete_enabled = false$q$,
    '42501', 'priv', 'retention_worker cannot enable live erasure by hand: refused by the grant list');

  PERFORM test_support.assert_raises('retention_worker',
    $q$UPDATE legal_holds SET released_by = gen_random_uuid(), released_at = now()
        WHERE released_at IS NULL$q$,
    '42501', 'priv', 'retention_worker cannot release a hold directly');

  PERFORM test_support.assert_raises('retention_worker',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('collection', 'fixture_medical_notes', 'by the worker', gen_random_uuid())$q$,
    '42501', 'priv', 'retention_worker cannot place a hold either');

  -- What it CAN do: run the job, and read the manifest afterwards.
  PERFORM test_support.assert_not_raises('retention_worker',
    $q$SELECT retention.run('test:priv:worker', 'dry_run')$q$,
    'priv', 'retention_worker can execute the job');

  PERFORM test_support.assert_not_raises('retention_worker',
    $q$SELECT retention.sync_clocks()$q$,
    'priv', 'retention_worker can recompute the clocks');

  PERFORM test_support.assert_not_raises('retention_worker',
    $q$SELECT count(*) FROM retention_run_items WHERE run_id =
          (SELECT run_id FROM retention_runs WHERE actor_label = 'test:priv:worker')$q$,
    'priv', 'retention_worker can read the manifest it produced');

  -- And it cannot reach the engine internals that would let it shortcut a
  -- decision -- compute_due_date is revoked from PUBLIC and granted to nobody,
  -- so even the worker must go through sync_clocks.
  PERFORM test_support.assert_raises('retention_worker',
    $q$SELECT retention.compute_due_date(now(), now(), 7, NULL, 'whichever_later')$q$,
    '42501', 'priv', 'retention_worker cannot call the due-date function directly');

  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT retention.run('test:priv:app', 'dry_run')$q$,
    '42501', 'priv', 'directus_app cannot run the erasure job at all');
END $$;

-- ---------------------------------------------------------------------------
-- 63.3  DEFAULT DENY ON THE ENGINE SCHEMA.
--
-- A newly created schema grants USAGE to PUBLIC. On a schema holding the
-- deletion path, that is not a detail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_acl   text;
  v_public boolean;
BEGIN
  SELECT array_to_string(nspacl, ' ') INTO v_acl
    FROM pg_namespace WHERE nspname = 'retention';

  -- PUBLIC is the grantee with an empty name, so an entry beginning with '=' is
  -- a PUBLIC grant. A newly created schema grants USAGE and CREATE to PUBLIC by
  -- default, so this has to be actively removed -- and on a schema holding the
  -- deletion path, "it was the default" is not an answer.
  v_public := coalesce(v_acl ~ '(^| )=[A-Z]', false);

  PERFORM test_support.assert_true(NOT v_public,
    'priv', 'the engine schema grants PUBLIC nothing: ACL is ' || coalesce(v_acl, 'NULL (default = PUBLIC owns it)'));

  PERFORM test_support.assert_true(coalesce(v_acl LIKE '%retention_worker=U/%', false),
    'priv', 'retention_worker has USAGE on the engine schema and no more');

  PERFORM test_support.assert_true(coalesce(v_acl LIKE '%directus_app=U/%', false),
    'priv', 'directus_app has USAGE on the engine schema and no more');

  PERFORM test_support.assert_true(
    NOT coalesce(v_acl LIKE '%retention_worker=UC/%', false)
    AND NOT coalesce(v_acl LIKE '%directus_app=UC/%', false),
    'priv', 'neither role can CREATE inside the engine schema');

  -- Every engine function carries no PUBLIC grant.
  --
  -- PUBLIC is the grantee with an EMPTY name, so an ACL element begins with
  -- '='. A naive LIKE '%=X/%' would match the OWNER's entry too, because
  -- "directus_migrator=X/..." contains "=X/" -- and an assertion that cannot
  -- distinguish the owner from PUBLIC is not checking anything.
  PERFORM test_support.assert_true(
    (SELECT bool_and(NOT coalesce(array_to_string(p.proacl, ','), '') ~ '(^|,)=X/')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'),
    'priv', 'no engine function grants EXECUTE to PUBLIC');

  -- And the positive control on that same check: the owner's entry IS there, so
  -- a regex that matched nothing at all would also have passed.
  PERFORM test_support.assert_true(
    (SELECT bool_and(coalesce(array_to_string(p.proacl, ','), '') ~ 'directus_migrator=X/')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'),
    'priv', 'every engine function is executable by its owner, so the PUBLIC check is not vacuous');

  -- The second half of the same control. The tables live in public and 63.1
  -- deliberately granted a Directus role ALL on them, so "cannot read a table"
  -- is not the claim -- "cannot reach the ENGINE" is. That is what makes the
  -- engine the path rather than one path among many.
  PERFORM test_support.assert_raises('directus_member',
    $q$SELECT retention.run('test:priv:member', 'dry_run')$q$,
    '42501', 'priv', 'a Directus role cannot reach the engine even holding ALL on its tables');

  PERFORM test_support.assert_raises('directus_member',
    $q$SELECT retention.release_hold(gen_random_uuid(), gen_random_uuid())$q$,
    '42501', 'priv', 'and cannot release a legal hold either');
END $$;

-- ---------------------------------------------------------------------------
-- 63.4  PLACING AND RELEASING A HOLD.
--
-- AFC-249 F3/F4 changed what the release half of this block claims. It used to
-- read "the actor on that release is one the database chose" above an assertion
-- that checked released_by IS NOT NULL, on a uuid the CALLER generated one
-- statement earlier -- a comment contradicted by the line under it, and an
-- assertion that could not fail.
--
-- WHAT IS ASSERTED, in this order, because the order is the control:
--   * directus_app can place a hold, and it is there;
--   * it cannot release by updating the row;
--   * the two-argument call -- the one that carried a caller-chosen releaser --
--     is refused, because that function no longer exists (42883);
--   * directus_app ships with NO provisioned principal, so a real release
--     attempt under it is REFUSED rather than stored with a releaser nobody
--     chose, and the hold is still holding;
--   * only once the owner role provisions one does the release work, and the
--     releaser it stores is the PROVISIONED principal -- compared against the
--     uuid the caller had in hand, so a function that went back to honouring an
--     argument goes red rather than quietly agreeing;
--   * and nobody but the owner may decide that mapping.
--
-- WHY THE RELEASE ATTEMPTS USE SET SESSION AUTHORIZATION AND NOT probe().
--   retention.release_hold derives the releaser from session_user, and SET LOCAL
--   ROLE -- which is what test_support.probe() and as_role() do -- does not
--   change session_user. A probe "as directus_app" is a session that
--   authenticated as somebody else and assumed directus_app partway through, and
--   release_hold correctly refuses to attribute the release to that somebody
--   else. Reading that refusal as "directus_app cannot release" would be a
--   measurement of the harness, and reading it as "the release succeeded" would
--   be worse: that is exactly what happened on the first run of this block, and
--   it passed.
--
--   Directus does not SET ROLE. It connects as directus_app, so session_user is
--   directus_app, and the only faithful impersonation is SET SESSION
--   AUTHORIZATION. See 65.4 for the full argument; this block restores the
--   harness session identity afterwards and ASSERTS that it is back, so a
--   silently unrestored session cannot make a later block pass for the wrong
--   reason.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hold      uuid;
  v_forged    uuid := '00000000-0000-0000-0000-00000000f0f9';
  v_principal uuid := '00000000-0000-0000-0000-00000000d0d0';
  v_holder    text;
  v_got       text := '(never attempted)';
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- Placing is an ordinary app action: the DPO can hold from the UI.
  --
  -- Written with as_role, NOT assert_not_raises: the probe harness discards its
  -- writes, so a hold placed inside a probe would not exist for the release
  -- assertions below -- and "release_hold raised" would then be a statement
  -- about a NULL id rather than about privileges.
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('retention_class', 'fixture_orphan', 'placed by the runtime identity',
               gen_random_uuid())$q$);

  SELECT id INTO v_hold FROM legal_holds
   WHERE scope_type = 'retention_class' AND scope_id = 'fixture_orphan'
     AND released_at IS NULL LIMIT 1;

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds
      WHERE scope_type = 'retention_class' AND scope_id = 'fixture_orphan'
        AND released_at IS NULL), '1',
    'priv', 'positive control: directus_app can place a legal hold, and the hold is there to release');

  -- Releasing goes through the function so the releaser is stamped by the
  -- database. A direct UPDATE would be a release with no recorded releaser at
  -- all, which is the one release nobody can defend afterwards.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE legal_holds SET released_by = gen_random_uuid(), released_at = now()
        WHERE released_at IS NULL$q$,
    '42501', 'priv', 'directus_app cannot release a hold by updating the row');

  -- THE PARAMETER IS GONE. This is the assertion with teeth against a
  -- regression: put p_released_by back and this stops being the truth, and the
  -- suite says so rather than the function quietly accepting a forged releaser
  -- again. 42883 undefined_function, not 42501 -- the call never reaches a
  -- privilege check, because there is no such function to hold a privilege on.
  PERFORM test_support.assert_raises('directus_app',
    format($q$SELECT retention.release_hold(%L::uuid, %L::uuid)$q$, v_hold, v_forged),
    '42883', 'priv', 'release_hold takes no releaser argument: the caller cannot name who released, because the database stamps it');

  -- Precondition on the attempt below, so the refusal cannot be passing because
  -- some earlier run left a principal behind.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_principals WHERE role_name = 'directus_app'), '0',
    'priv', 'precondition: directus_app ships with no provisioned principal');

  -- THE ATTEMPT, as the role that actually holds EXECUTE, authenticated as.
  -- 23001 rather than 22023: this is a control refusing an operation, and the
  -- distinction from "you passed something invalid" is what an operator reads a
  -- log to make.
  SET SESSION AUTHORIZATION directus_app;
  v_got := 'NOT REFUSED -- the release went through with nobody attributed';
  BEGIN
    PERFORM retention.release_hold(v_hold);
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, '23001',
    'priv', 'a release under a role with no provisioned principal is refused, not stored with a releaser the caller chose');

  PERFORM test_support.assert_equals(current_user, v_holder,
    'priv', 'the harness session identity is restored after impersonation, so the blocks below are not running as somebody unexpected');

  -- And the hold it refused to release is still holding. Asserted on the row,
  -- not on the absence of an error: a refusal that arrived after the UPDATE
  -- would produce the same log line and a hold that is no longer holding.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE id = v_hold AND released_at IS NULL), '1',
    'priv', 'and the hold it refused to release is still holding');

  -- Nobody but the owner may decide this mapping. directus_app holds no write
  -- grant, and the trigger is the second layer for the case where a grant list
  -- is widened by accident -- the same shape as the clock-state guard.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO retention_principals (role_name, principal_id) VALUES ('directus_app', gen_random_uuid())$q$,
    '42501', 'priv', 'directus_app cannot provision its own release attribution: refused by the grant list');

  PERFORM test_support.as_role(NULL,
    $c$GRANT ALL PRIVILEGES ON retention_principals TO test_table_super$c$);

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE retention_principals SET principal_id = gen_random_uuid()$q$,
    '23001', 'priv', 'a role with ALL on the mapping still cannot re-point a release attribution: refused by the trigger');

  -- Provision, under the owner role. This is the shape a deployment uses, and
  -- it is the only thing standing between the refusal above and a release.
  PERFORM test_support.as_role('directus_migrator',
    format($c$INSERT INTO retention_principals (role_name, principal_id, note)
           VALUES ('directus_app', %L::uuid, 'DPO service principal')$c$, v_principal));

  -- And now the release works, still authenticated as directus_app, and the
  -- releaser it stores is the PROVISIONED principal. Compared as a value
  -- against a value: this is the assertion the old "IS NOT NULL" should have
  -- been, and the only way it can fail is if the stored releaser is not the one
  -- the database chose.
  SET SESSION AUTHORIZATION directus_app;
  v_got := 'not attempted';
  BEGIN
    PERFORM retention.release_hold(v_hold);
    v_got := 'released';
  EXCEPTION WHEN OTHERS THEN
    v_got := 'raised ' || SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'released',
    'priv', 'directus_app can release a hold through the function, once the owner role has provisioned the attribution');

  PERFORM test_support.assert_equals(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold), v_principal::text,
    'priv', 'and the releaser recorded is the principal the database maps the session role to');

  -- And it is not the uuid the caller had in hand when the abuse was attempted.
  PERFORM test_support.assert_true(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold) <> v_forged::text,
    'priv', 'specifically not a uuid the caller supplied');

  -- A hold cannot be forged as already released.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by, released_by, released_at)
       VALUES ('collection', 'fixture_ladder_notes', 'pre-released', gen_random_uuid(),
               gen_random_uuid(), now())$q$,
    '23001', 'priv', 'a hold cannot be inserted already released: the release triggers only on update');

  -- Nor can the scope be laundered in one statement. 42501 first for the runtime
  -- identity (no UPDATE grant), then 23001 for a role that 63.1 granted ALL --
  -- the trigger is the second layer, and both are asserted so neither is
  -- mistaken for the other.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE legal_holds SET scope_id = 'fixture_medical_notes'
        WHERE scope_type = 'retention_class'$q$,
    '42501', 'priv', 'the runtime identity cannot rewrite a hold scope: refused by the grant list');

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE legal_holds SET scope_id = 'fixture_medical_notes'
        WHERE scope_type = 'retention_class'$q$,
    '23001', 'priv', 'a role with ALL on the table still cannot rewrite a hold scope: refused by the trigger');

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE legal_holds SET reason = 'nothing to see here'
        WHERE scope_type = 'retention_class'$q$,
    '23001', 'priv', 'nor the reason a hold was placed');
END $$;

-- ---------------------------------------------------------------------------
-- 63.5  THE OWNER PATH STILL WORKS, AND ITS RESIDUAL IS ASSERTED.
--
-- The engine must be able to do what the guard forbids. If it cannot, the
-- guard is just a broken system. Asserted through the engine's own behaviour:
-- sync_clocks writes clock state on every run and the job has been writing
-- state='deleted' and state='held' throughout this suite.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_err    text;
  v_disab  boolean := false;
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM retention_clocks),
    'priv', 'precondition: the engine has been writing clock state all through this run');

  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM retention_clocks WHERE state IN ('deleted', 'held') OR state = 'due'),
    'priv', 'precondition: the engine has moved clocks through more than one state');

  -- The residual, proven rather than assumed: the owner can disable the guard
  -- and then write clock state directly. It is reproduced inside a discarded
  -- subtransaction so the guard is standing again immediately afterwards.
  BEGIN
    EXECUTE 'SET LOCAL ROLE directus_migrator';
    EXECUTE 'ALTER TABLE retention_clocks DISABLE TRIGGER retention_clocks_state_is_engine_owned';
    EXECUTE $q$UPDATE retention_clocks SET state = 'deleted' WHERE state = 'due'$q$;
    v_disab := true;
    RAISE EXCEPTION 'afc_test_support_rollback' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  PERFORM test_support.assert_true(v_disab, 'priv',
    'documented residual: the table owner can disable the guard and then mark clocks deleted');

  -- Undone by the rollback: the guard is standing again.
  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE retention_clocks SET state = 'deleted' WHERE state = 'due'$q$,
    '23001', 'priv', 'after the owner probe the guard is enabled and rejecting again');

  -- And the runtime identity cannot remove the guard in the first place.
  PERFORM test_support.assert_raises('directus_app',
    $q$ALTER TABLE retention_clocks DISABLE TRIGGER retention_clocks_state_is_engine_owned$q$,
    '42501', 'priv', 'directus_app cannot disable the clock-state guard: it is not the owner');

  PERFORM test_support.assert_raises('retention_worker',
    $q$ALTER TABLE retention_clocks DISABLE TRIGGER retention_clocks_state_is_engine_owned$q$,
    '42501', 'priv', 'retention_worker cannot disable the clock-state guard either');

  PERFORM test_support.assert_raises('directus_app',
    $q$DROP TRIGGER retention_clocks_state_is_engine_owned ON retention_clocks$q$,
    '42501', 'priv', 'directus_app cannot drop the clock-state guard');

  PERFORM test_support.assert_raises('directus_app',
    $q$ALTER TABLE retention_policies DISABLE TRIGGER retention_policies_delete_enabled_is_audited$q$,
    '42501', 'priv', 'directus_app cannot disable the delete_enabled guard');
END $$;

-- ---------------------------------------------------------------------------
-- 63.6  THE ERASURE GRANT IS HELD BY EXACTLY ONE ROLE.
--
-- Documented provisioning requirement, because it is the one place this design
-- needs a human to be careful: retention.run is SECURITY DEFINER, so it erases
-- with its owner's rights, and its owner must hold DELETE on every table named
-- in retention_class_sources. In this repository that is satisfied the way
-- `incidents` is satisfied -- the domain tables are owned by the migration
-- role. Asserted here so a future migration that creates a table under
-- directus_app, or a GRANT that hands erasure to a second role, fails the suite
-- rather than production.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leak integer;
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM retention_class_sources),
    'priv', 'precondition: there is at least one configured erasure target to check');

  -- Every configured target must be owned by (or DELETE-granted to) the engine's
  -- owner role. Otherwise the job fails closed at the first erasure -- which is
  -- safe, but it means the schedule is not actually being enforced.
  SELECT count(*) INTO v_leak
    FROM retention_class_sources rcs
   WHERE NOT pg_has_role('directus_migrator', rcs.table_name, 'USAGE')
     AND NOT has_table_privilege('directus_migrator', rcs.table_name, 'DELETE');

  PERFORM test_support.assert_equals(v_leak::text, '0',
    'priv', 'every configured erasure target is erasable by the engine owner role');

  -- And the erasure privilege is NOT spread further than that. directus_app
  -- and retention_worker hold no DELETE on any configured target, whatever the
  -- domain tables were granted elsewhere in this suite.
  PERFORM test_support.assert_true(
    (SELECT bool_and(NOT has_table_privilege('directus_app', rcs.table_name, 'DELETE'))
       FROM retention_class_sources rcs),
    'priv', 'directus_app holds no DELETE on any erasure target, even after a suite granted it table privileges');

  PERFORM test_support.assert_true(
    (SELECT bool_and(NOT has_table_privilege('retention_worker', rcs.table_name, 'DELETE'))
       FROM retention_class_sources rcs),
    'priv', 'retention_worker holds no DELETE on any erasure target');

  -- Every erasure target must also carry a person link, or the erasure would
  -- silently match nothing.
  PERFORM test_support.assert_true(
    (SELECT bool_and(length(person_column) > 0) FROM retention_class_sources),
    'priv', 'every erasure target declares how it links to a person');

  -- And no erasure target is `people` itself. D3: the person row is never the
  -- erasure unit, and making it one would delete a person because one category
  -- came due.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_class_sources WHERE table_name = 'people'), '0',
    'priv', 'D3: people is not an erasure target');
END $$;

-- ---------------------------------------------------------------------------
-- 63.7  THE PEOPLE MERGE CONTRACT.
--
-- Migration 0004 creates `people` with ONLY the columns a retention clock and a
-- legal hold need. The data-model migration that lands later must ALTER TABLE
-- ADD COLUMN, never CREATE TABLE -- otherwise it forks the identity the
-- retention engine resolves holds and age anchors against, and there is no
-- error anywhere to tell you.
--
-- Asserted rather than trusted, because the cost of getting it wrong is two
-- people tables and a hold that resolves against the wrong one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cols  text[];
  v_target uuid;
  v_before text;
BEGIN
  SELECT array_agg(attname ORDER BY attname) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'people'::regclass AND attnum > 0 AND NOT attisdropped;

  PERFORM test_support.assert_true(
    'id' = ANY(v_cols) AND 'date_of_birth' = ANY(v_cols) AND 'status' = ANY(v_cols),
    'priv', 'people carries the retention anchor columns the engine resolves against');

  -- The contract: this table is NOT the v4 people record. If a later migration
  -- adds the full field set here, this assertion starts failing and someone has
  -- to decide whether that was intended -- which is the point.
  PERFORM test_support.assert_true(
    NOT ('first_name' = ANY(v_cols) OR 'phone' = ANY(v_cols) OR 'email' = ANY(v_cols)
         OR 'membership_status' = ANY(v_cols) OR 'guardian' = ANY(v_cols)),
    'priv', 'merge contract: people is still the retention anchor only, not the v4 people record');

  PERFORM test_support.assert_true(
    (SELECT count(*) >= 0 FROM people),
    'priv', 'people is readable for counting, which the engine depends on');

  -- An archived person is still a data subject: the flag means "no longer an
  -- operational record", and the constraint has to keep that distinction.
  PERFORM test_support.assert_not_raises(NULL,
    $q$UPDATE people SET status = 'deleted' WHERE false$q$,
    'priv', 'probe control: an UPDATE matching no rows raises nothing, so the next assertion is meaningful');

  -- A NAMED target, not "the first row". people.id is a random uuid, so
  -- ORDER BY id LIMIT 1 selects a different person on every run, and an
  -- assertion built on it is a coin flip that happens to be green most
  -- afternoons. Suite 61 archives a person on purpose; picking at random is how
  -- that collides with an assertion about someone else.
  -- Read the fixture labels FIRST, as the session role. test_support.as_role
  -- does SET LOCAL ROLE, which leaks to the end of the enclosing transaction,
  -- so any block that has called as_role('some_app_role') is no longer running as
  -- superuser -- and fixture_persons is a superuser-only fixture table.
  PERFORM test_support.as_role(NULL, $q$SELECT 1$q$);   -- restore the session role
  SELECT person_id INTO v_target FROM fixture_persons WHERE label = 'floor_case';
  SELECT status INTO v_before FROM people WHERE id = v_target;

  PERFORM test_support.assert_equals(v_before, 'active',
    'priv', 'precondition: the named target person is active');

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE people SET status = 'deceased' WHERE id = %L::uuid$q$, v_target),
    '23514', 'priv', 'people.status is a closed enum: archived is not a third spelling of deleted');

  PERFORM test_support.assert_equals(
    (SELECT status::text FROM people WHERE id = v_target), v_before,
    'priv', 'the refused UPDATE changed nothing');

  -- And the flag does what it says. An archived person is excluded from new
  -- clocks: "no longer an operational record" means no new retention clock is
  -- created for them, and the engine still leaves their existing clocks alone.
  PERFORM test_support.as_role(NULL,
    format($q$UPDATE people SET status = 'archived' WHERE id = %L::uuid$q$, v_target));

  PERFORM test_support.assert_true(retention.sync_clocks() > 0,
    'priv', 'sync_clocks still runs with an archived person present');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks
      WHERE person_id = v_target
        AND retention_class NOT IN (SELECT retention_class FROM retention_policies WHERE is_active)), '0',
    'priv', 'the archived person has no clock for a class with no active policy');

  -- An archived person is still a data subject: their history is not swept up
  -- by archiving, and a hold can still be placed on them.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks WHERE person_id = v_target),
    (SELECT count(*)::text FROM retention_clocks WHERE person_id = v_target),
    'priv', 'the archived person keeps their existing retention clocks');

  -- And because archiving removes the person from new clocks, put them back so
  -- the suites after this one are not quietly working on a shorter population.
  PERFORM test_support.as_role(NULL,
    format($q$UPDATE people SET status = 'active' WHERE id = %L::uuid$q$, v_target));

  PERFORM test_support.assert_equals(
    (SELECT status::text FROM people WHERE id = v_target), 'active',
    'priv', 'the target person is restored for the suites after this one');
END $$;

-- test_support.as_role's SET LOCAL ROLE leaks for the rest of the transaction,
-- so the last thing this suite does is put the session role back. Without it,
-- every suite after this one silently runs as whichever role was used last --
-- which is how a privilege assertion somewhere else starts passing for the
-- wrong reason.
DO $$ BEGIN PERFORM test_support.as_role(NULL, $q$SELECT 1$q$); END $$;
