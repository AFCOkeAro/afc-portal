-- tests/db/67_retention_worker_live_run.sql
--
-- AFC-261, from the AFC-232 review of ADR-0002 Part 2. THE LIVE ERASURE HAS
-- NEVER BEEN EXECUTED UNDER THE IDENTITY THAT PERFORMS IT.
--
-- THE GAP, MEASURED ON THE REVIEWED SNAPSHOT
--   Eight `retention.run(..., 'live')` calls shipped: three in 61, five in 62.
--   Every one of them is issued from the runner's session, which is a
--   superuser, and a superuser bypasses every privilege check. Those eight calls
--   exercise the engine's LOGIC and none of its PRIVILEGE BOUNDARY.
--   Seven further calls are driven as a non-owner -- in 63, 64, 65 -- and all
--   seven are dry_run.
--
--   So no shipped test performed a live erasure as retention_job. This is the F2
--   shape one altitude up: F2 was correct in source and broken in production
--   because every test drove the engine as the function owner.
--
-- WHAT MUTATION M3 DOES AND DOES NOT COVER
--   Removing SECURITY DEFINER from retention.run turns suites 61-65 red, because
--   retention.run writes retention_runs itself and holds no grant on it. That
--   protects the ENTRYPOINT. Nothing protected the STEP BENEATH it: a regression
--   that moved the live DELETE out of the definer's rights, or that made the
--   erasure depend on something the worker lacks, would have shipped green.
--
--   This suite is that missing step. The erasure happens as retention_job, over a
--   due row, and the assertions are read back as a role that can see the table --
--   because a probe that discards its writes and reports "no exception raised"
--   proves only that nothing blew up. That is why 64 exists.
--
-- TWO TECHNIQUES ARE AVAILABLE AND ONLY ONE OF THEM MEANS ANYTHING
--   SET ROLE from the runner's superuser session proves nothing: PostgreSQL
--   checks SET ROLE against the SESSION user, so after SET ROLE anything from a
--   superuser session succeeds for any role at all. Measured on this tree:
--   `SET ROLE other_app; SET LOCAL ROLE retention_worker;` -> ALLOWED, where
--   other_app is neither a member of retention_worker nor a superuser. Suite 65's
--   header records the measurement. So there is no SET ROLE anywhere in this
--   file, and the impersonation is SET SESSION AUTHORIZATION, which does drop the
--   session user and so is decided by membership and only by membership.
--
--   SET SESSION AUTHORIZATION is named explicitly on the way back rather than
--   RESET, because RESET SESSION AUTHORIZATION is a no-op in PGlite 0.2.17
--   (measured: session_user stays retention_job after it) while naming the role
--   the connection is already authenticated as is correct under PGlite and a
--   harmless no-op on a real server.
--
-- SUITE ORDER IS DEFENDED AGAINST, NOT ASSUMED
--   65.5 leaves SESSION AUTHORIZATION set to retention_job, so a suite numbered
--   67 runs after it and would begin as retention_job. 66 restores it. This file
--   relies on neither: it names the harness identity explicitly at the top of its
--   own block, ASSERTS it, and restores it again on the way out. A suite whose
--   precondition is "the previous suite tidied up" reports a green run on a dirty
--   session.
--
-- ITS OWN FIXTURE, NOT ANOTHER SUITE'S
--   Its own person, its own fixture_medical_notes row, its own closed concern.
--   Several suites restore their state on the way out and depend on running
--   first; reusing one of those fixtures would make 67 a passenger of whichever
--   suite happened to go before it.
--
-- WHAT IS ASSERTED
--   67.1  the fixture clock is genuinely due, the policy is enabled, no hold is
--         in force, and exactly one row is waiting -- all asserted, because
--         "the hold stopped it" and "nothing was ever deletable" are otherwise
--         indistinguishable readings of a surviving row
--   67.2  the session really is retention_job and really is not a superuser
--   67.3  a LIVE run as retention_job returns a run id, and the target row count
--         is 0. This is the assertion the eight superuser-driven calls could not
--         make
--   67.4  the manifest records action = 'deleted': the evidence is truthful
--   67.5  the run is recorded succeeded, in live mode
--   67.6  retention_runs.actor = 'retention_job' -- the SESSION -- and
--         actor_label is the caller's string, which is a label and not an
--         attribution. This is the NDPA s.40(2) evidence and it is the assertion
--         a superuser-driven call cannot produce
--   67.7  THE NEGATIVE CONTROL: an identity with no membership is refused
--         42501 on the same live call, and leaves behind no run and no erasure.
--         Without it the positive case cannot be told apart from session
--         authority having done the work. A gate nobody has watched fail is
--         untested -- that is the standing rule in this repository.

-- ---------------------------------------------------------------------------
-- 67.1  FIXTURE AND PRECONDITIONS.
--
-- The policy row is inserted idempotently rather than assumed: the same
-- (rule_key, version) 61 creates, so 67 does not depend on 61 having run and
-- still cannot create a second active rule for the class.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_person uuid;
  v_due    timestamptz;
  v_rows   integer;
BEGIN
  -- Suite order defended: do not inherit whatever identity the suite before left.
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(current_user, v_holder,
    'worklive', 'precondition: this block starts as the harness identity, not as whatever an earlier suite left behind');

  INSERT INTO retention_policies
    (rule_key, retention_class, version, effective_from,
     anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
  VALUES ('fixture.medical', 'fixture_medical', 1, now() - interval '1 day',
          'fixture_case_closed_at', 1, 'whichever_later', '["identified"]'::jsonb, true, true)
  ON CONFLICT (rule_key, version) DO NOTHING;

  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_person;
  INSERT INTO fixture_persons VALUES ('live_worker_person', v_person);

  INSERT INTO fixture_medical_notes (person_id, body)
  VALUES (v_person, 'AFC-261 live erasure under the production identity');

  -- The closed concern is what makes the medical clock computable at all.
  -- Without it the clock is indeterminate and everything below would be
  -- satisfied by a fixture that was never erasable in the first place.
  INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
  VALUES (v_person, now() - interval '3 years');

  -- Drive the clock as the session role. The job calls sync_clocks before it
  -- calls run; this is that call, not a fixture shortcut.
  PERFORM retention.sync_clocks();

  SELECT due_at INTO v_due FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_medical';

  -- Asserted as an INSTANT, not a rendering, so the assertion does not depend on
  -- the session TimeZone. Asserting v_due::text would be green on a UTC runner
  -- by accident of the clock (AFC-202).
  PERFORM test_support.assert_true(
    v_due IS NOT NULL AND v_due <= now(),
    'worklive', 'precondition: the 67 fixture clock is genuinely due, not indeterminate and not in the future');

  PERFORM test_support.assert_true(
    (SELECT delete_enabled FROM retention_policies WHERE rule_key = 'fixture.medical' AND version = 1),
    'worklive', 'precondition: the class policy has live erasure enabled, so a surviving row is a failure and not a policy');

  PERFORM test_support.assert_true(
    NOT retention.has_active_hold(v_person, 'fixture_medical'),
    'worklive', 'precondition: no hold is in force on this fixture, so what follows is not a hold test wearing a live-run label');

  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_person;
  PERFORM test_support.assert_equals(v_rows::text, '1',
    'worklive', 'precondition: exactly one row of THIS suite''s fixture is waiting to be erased');
END $$;

-- ---------------------------------------------------------------------------
-- 67.2 to 67.6  THE LIVE ERASURE, AS retention_job.
--
-- Call, restore, and read-back are in one block because the run id exists only
-- in memory here. Re-finding it by label afterwards would make the attribution
-- assertions depend on the untrusted string, which is the thing under test.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_who    text;
  v_super  text;
  v_run    uuid := NULL;
  v_person uuid;
  v_rows   integer := -1;
  v_action text;
  v_status text;
  v_mode   text;
  v_actor  text;
  v_label  text;
BEGIN
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'live_worker_person';

  SET SESSION AUTHORIZATION retention_job;
  SELECT current_user, (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)
    INTO v_who, v_super;

  -- The two preconditions of the technique, asserted rather than trusted. A
  -- superuser wearing the role's name would satisfy every assertion below and
  -- prove nothing, which is precisely what 65.5's control B exists to catch.
  PERFORM test_support.assert_equals(v_who, 'retention_job',
    'worklive', 'precondition: the session is the ordinary LOGIN identity the scheduler connects as');

  PERFORM test_support.assert_equals(v_super, 'false',
    'worklive', 'precondition: that identity is NOT a superuser, so the erasure below cannot be a superuser override');

  -- THE CALL. 'test:worker:live' is deliberately not a real principal: it is the
  -- caller's label, and 67.6 asserts that it is not what attribution reads.
  v_run := retention.run('test:worker:live', 'live');

  -- Back to the harness identity BEFORE reading anything. The evidence is
  -- gathered by a role that can see the erasure target, rather than by the
  -- identity whose view of it is part of what is being tested.
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_true(v_run IS NOT NULL,
    'worklive', 'the LIVE call as retention_job returned a run id');

  -- 67.3. The assertion the eight superuser-driven calls could not make.
  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_person;
  PERFORM test_support.assert_equals(v_rows::text, '0',
    'worklive', 'a LIVE run as retention_job ACTUALLY REMOVED the row (count 1 -> 0), so this is not a dry run reporting success');

  -- 67.4. The manifest is the evidence. 'would_delete' here, with 0 rows on the
  -- table, would mean the run deleted nothing and reported nothing honest.
  SELECT action::text INTO v_action FROM retention_run_items
   WHERE run_id = v_run AND person_id = v_person AND retention_class = 'fixture_medical';
  PERFORM test_support.assert_equals(v_action, 'deleted',
    'worklive', 'the manifest records action=deleted, so the evidence agrees with the row count');

  -- 67.5.
  SELECT status::text, mode::text INTO v_status, v_mode FROM retention_runs WHERE run_id = v_run;
  PERFORM test_support.assert_equals(v_status, 'succeeded',
    'worklive', 'the run is recorded as succeeded');
  PERFORM test_support.assert_equals(v_mode, 'live',
    'worklive', 'and the run really ran in live mode');

  -- 67.6. NDPA s.40(2): attribution is the session, not the caller's string.
  SELECT actor, actor_label INTO v_actor, v_label FROM retention_runs WHERE run_id = v_run;
  PERFORM test_support.assert_equals(v_actor, 'retention_job',
    'worklive', 'the erasure is attributed to the SESSION identity, which is the s.40(2) evidence');

  -- And the caller's string really did land in the label column, so the assertion
  -- above is not passing on an empty string.
  PERFORM test_support.assert_equals(v_label, 'test:worker:live',
    'worklive', 'the caller''s own words are recorded as a LABEL and are not the attribution');

  PERFORM test_support.assert_equals(current_user, v_holder,
    'worklive', 'the harness session identity is restored after the live block');
END $$;

-- ---------------------------------------------------------------------------
-- 67.7  THE NEGATIVE CONTROL.
--
-- directus_app holds no EXECUTE on retention.run and no membership in
-- retention_worker, so it must be refused the live call with 42501. Two reasons
-- this control is load-bearing rather than decorative:
--
--   * It is what makes 67.3-67.6 mean "retention_job erased this" rather than
--     "the session was sufficiently privileged to erase something". A positive
--     case with no negative control is indistinguishable from a cluster where
--     anybody can erase.
--   * It asserts the CONTROL as well as the case: the refused call must leave no
--     run row behind. A refusal that still wrote a manifest is a run that reports
--     itself as executed by an identity that was refused.
--
-- The control uses SET SESSION AUTHORIZATION too, for the same reason as the
-- positive case: a SET ROLE from the runner's superuser session would succeed
-- against anything and would not be testing the boundary at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_state  text := '(never attempted)';
  v_runs   integer;
  v_person uuid;
BEGIN
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'live_worker_person';

  SET SESSION AUTHORIZATION directus_app;

  BEGIN
    PERFORM retention.run('test:worker:live:control', 'live');
    v_state := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    v_state := 'DENIED ' || SQLSTATE;
  END;

  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_state, 'DENIED 42501',
    'worklive', 'control: an identity with no membership is refused the live run, so the positive case was membership and not session authority');

  -- And the refusal left no evidence of an erasure.
  SELECT count(*) INTO v_runs FROM retention_runs WHERE actor_label = 'test:worker:live:control';
  PERFORM test_support.assert_equals(v_runs::text, '0',
    'worklive', 'control: the refused call left no run row, so a refusal cannot report itself as an executed erasure');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_medical_notes WHERE person_id = v_person), '0',
    'worklive', 'control: and it erased nothing -- the row count is still what the authorised run left');

  PERFORM test_support.assert_equals(current_user, v_holder,
    'worklive', 'the harness session identity is restored after the control');
END $$;
