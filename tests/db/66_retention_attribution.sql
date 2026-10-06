-- tests/db/66_retention_attribution.sql
--
-- AFC-249. IMPLEMENTING THE AFC-230 INDEPENDENT SECURITY REVIEW.
--
-- AFC-230 measured seven findings on a pristine HEAD, all by execution rather
-- than by reading: a caller-supplied clock on the deletion path (F1), a
-- caller-supplied actor on the attribution evidence (F2), a caller-supplied
-- releaser on a legal-hold release (F3), two tests that asserted those
-- properties and could not fail (F4), caller-supplied run timestamps feeding a
-- monotone alarm (F5), the clock suppressing erasure as well as widening it
-- (F6), and a dry_run that wrote (F7). This file is where each is measured.
--
-- WHY A SEPARATE SUITE, AND NOT AN APPEND TO 62
--   62 builds its fixture with delete_enabled = true policies, so a live run
--   there erases real rows. These assertions need a live run that is REFUSED --
--   refused runs erase nothing by construction, but the control run that proves
--   the refusal is not hiding a broken predicate does erase -- and 63, 64 and 65
--   all assert on retention_clocks.state after 62 has run. A live erasure from
--   inside 62's fixture would move those states out from under them. So this
--   suite owns its own class, its own erasure target and its own people, and it
--   sorts last so its live runs cannot disturb an earlier suite's assertions.
--
-- WHY EVERY IMPERSONATION HERE IS SET SESSION AUTHORIZATION
--   The whole of F1, F2, F5 and F6 is about values the DATABASE derives rather
--   than accepts: session_user, now(), a provisioned principal. Two of those
--   are invisible to the harness's usual technique. test_support.probe() and
--   as_role() do SET LOCAL ROLE, which changes current_user and leaves
--   session_user exactly where it was -- so "a probe as retention_job" is a
--   session that authenticated as the runner and assumed the worker partway
--   through, and retention.run correctly records the runner. Asserting on that
--   measures the harness.
--
--   Directus connects as directus_app and the scheduler connects as
--   retention_job; neither does SET ROLE. SET SESSION AUTHORIZATION is the only
--   technique that reproduces either, which is the argument suite 65 already
--   makes at length. Every block below restores the harness session identity
--   afterwards AND ASSERTS that it is back, because a silently unrestored
--   session makes every later block a measurement of the wrong thing.
--
-- WHAT IS ASSERTED
--   66.0  the harness session identity is restored, so nothing below is
--         asserting from an identity the fixture did not intend
--   66.1  the fixture: a due person, a future-due person, and a held person,
--         each with a collection row, so erasure is observable
--   66.2  F1/F6 -- a caller-supplied clock on a LIVE run is refused in BOTH
--         directions, as retention_job, and the collection rows are asserted
--         rather than the absence of an exception
--   66.3  F2  -- retention_runs.actor is the session and not the caller's
--         string, an empty actor is refused, a non-LOGIN session is refused, and
--         the application role cannot reach the engine at all
--   66.4  F5  -- no run row carries a started_at/finished_at outside a sane
--         window of now(), asserted as the worker, with a negative control so
--         the window is a measurement
--   66.5  F7  -- a dry_run leaves retention_clocks.state byte-identical, and a
--         held clock is named explicitly rather than counted
--   66.6  F7  -- a preview clock is honoured FORWARD and refused BACKWARD, and
--         which of those is intended is pinned in the assertion names
--   66.7  F3  -- the worker cannot release a legal hold, so the only identity
--         that can is the one whose attribution the database derives

-- ---------------------------------------------------------------------------
-- 66.0  THE SESSION IS THE HARNESS'S, NOT SOMEBODY ELSE'S.
--
-- Suite 65 impersonates retention_job and directus_app and, on PGlite, does not
-- restore: RESET SESSION AUTHORIZATION is documented there as not restoring
-- current_user on that engine. So a suite sorting after 65 must restore the
-- identity itself rather than assume it. The name is not hard-coded -- it is
-- read from the same config row the harness recorded it in.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_who    text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  PERFORM test_support.assert_true(v_holder IS NOT NULL AND v_holder <> '',
    'attr', 'precondition: the harness recorded the session role it installed under');

  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);
  SELECT current_user INTO v_who;

  PERFORM test_support.assert_equals(v_who, v_holder,
    'attr', 'precondition: the harness session identity is restored, so nothing below is asserting from an identity the fixture did not intend');
END $$;

-- ---------------------------------------------------------------------------
-- 66.1  THE FIXTURE.
--
-- Its own class, its own erasure target, its own people. Three shapes, and each
-- exists because one assertion needs it and no other shape will do:
--
--   due_now     due_at in the past. The control run must erase this one.
--   future_due  due_at in the future. The future-clock abuse must not reach it,
--               and the forward preview must.
--
-- The held person is NOT built here. 66.2's control run is a LIVE run, and a
-- live run marks held clocks 'held' -- correct behaviour, and it would leave
-- 66.5 asserting against a clock that was already held before its dry run ever
-- ran. So 66.5 builds its own held person, after the live runs, where the state
-- it measures is one it created.
--
-- The anchor is the harness's existing person-attribute anchor on
-- people.date_of_birth, so a person born long ago is due and a person born
-- shortly is not. No new anchor row and no new period: the policy's floor is
-- read from the row below like any other.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_due     uuid;
  v_future  uuid;
BEGIN
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_forge_notes (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         person_id uuid NOT NULL,
         body text
       )$c$);

  PERFORM test_support.as_role(NULL,
    $c$INSERT INTO retention_class_sources (retention_class, table_name, person_column)
       VALUES ('fixture_forge', 'fixture_forge_notes', 'person_id')
       ON CONFLICT DO NOTHING$c$);

  PERFORM test_support.as_role(NULL,
    $c$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from,
          anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
       VALUES ('fixture.forge', 'fixture_forge', 1, now() - interval '1 day',
               'fixture_date_of_birth', 1, 'whichever_later', '["identified"]'::jsonb,
               true, true)
       ON CONFLICT (rule_key, version) DO NOTHING$c$);

  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_due;
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() + interval '30 days')::date,  'active') RETURNING id INTO v_future;

  INSERT INTO fixture_persons VALUES ('forge_due_now', v_due);
  INSERT INTO fixture_persons VALUES ('forge_future_due', v_future);

  INSERT INTO fixture_forge_notes (person_id, body)
  VALUES (v_due,    'due now'),
         (v_future, 'due in the future');

  PERFORM retention.sync_clocks();

  -- Scoped to THIS suite's two people, and the scope is load-bearing rather than
  -- tidy: sync_clocks gives every active person a clock for every active policy,
  -- so fixture_forge clocks exist for all the fixture people the earlier suites
  -- left behind too. Counting the whole class would assert a number about those,
  -- and a number that moves whenever another suite adds a person.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks rc
       JOIN fixture_persons fp ON fp.person_id = rc.person_id
      WHERE fp.label = 'forge_due_now'
        AND rc.retention_class = 'fixture_forge' AND rc.state = 'due'), '1',
    'attr', 'precondition: the due-now fixture clock is genuinely due');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks rc
       JOIN fixture_persons fp ON fp.person_id = rc.person_id
      WHERE fp.label = 'forge_future_due'
        AND rc.retention_class = 'fixture_forge'
        AND rc.due_at > now() AND rc.state = 'live'), '1',
    'attr', 'precondition: the other fixture clock has a due_at in the future and is live');
END $$;

-- ---------------------------------------------------------------------------
-- 66.2  F1 AND F6: THE LIVE PATH TAKES NO CLOCK FROM ITS CALLER.
--
-- A caller-supplied p_now on a live run was two defects, not one, and both are
-- an NDPA failure:
--
--   future  selection is by due_at <= p_now, so one call a year ahead selects
--           records whose due dates have not arrived and erases them.
--   past    the same predicate selects nothing while records ARE due, and the
--           run records status='succeeded' with zero candidates -- which is
--           indistinguishable from "nothing to do". Over-retention needs no
--           forged future clock at all.
--
-- So the guard is two-sided: live refuses ANY p_now that is not the database's
-- own, rather than bounding it in one direction. The review's rejected option
-- -- "reject p_now > now() + 1 day" -- is left unquoted here on purpose.
--
-- ORDER MATTERS IN THIS BLOCK. Both abuses are attempted FIRST, before anything
-- has been erased, so that the control run afterwards demonstrates what the two
-- refusals prevented: the due records are still there after the refusals, and
-- gone after the honest call. Asserting the refusals after the control would
-- have nothing left to prove.
--
-- Everything below is asserted as retention_job, authenticated as, because a
-- SET LOCAL ROLE "as retention_job" would measure the harness (see the header).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder   text;
  v_due      uuid;
  v_future   uuid;
  v_run      uuid;
  v_future_got text;
  v_past_got   text;
  v_honest_got text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  SELECT person_id INTO v_due    FROM fixture_persons WHERE label = 'forge_due_now';
  SELECT person_id INTO v_future FROM fixture_persons WHERE label = 'forge_future_due';

  -- THE APPLICATION ROLE IS NOT A REACHABLE ERASER, stated before the worker is
  -- impersonated because it is the other half of F4: the abuse is attempted as
  -- directus_app too, and the refusal it gets is the grant list rather than the
  -- attribution check.
  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT retention.run('66:forge:as-app', 'live')$q$,
    '42501', 'clock', 'the application identity cannot reach the deletion path at all, so it cannot supply a clock to it');

  -- ABUSE ONE: a live run ten years into the future.
  SET SESSION AUTHORIZATION retention_job;
  v_future_got := 'NOT REFUSED -- the run selected records a decade early';
  BEGIN
    PERFORM retention.run('66:forge:future', 'live', now() + interval '3650 days');
  EXCEPTION WHEN OTHERS THEN
    v_future_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_future_got, '23001',
    'clock', 'F1: a live run with a caller-supplied FUTURE clock is refused, not silently run on the caller''s clock');

  -- ABUSE TWO: a live run anchored before the epoch.
  SET SESSION AUTHORIZATION retention_job;
  v_past_got := 'NOT REFUSED -- the run selected nothing and reported success';
  BEGIN
    PERFORM retention.run('66:forge:past', 'live', '1970-01-01'::timestamptz);
  EXCEPTION WHEN OTHERS THEN
    v_past_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_past_got, '23001',
    'clock', 'F6: a live run with a caller-supplied PAST clock is refused too, because suppressing erasure is the same NDPA failure as widening it');

  -- A refused call records nothing. The run row and the manifest are inside the
  -- transaction that raised, so "no run" is a property of the design rather than
  -- of an assertion that skipped.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE actor_label IN ('66:forge:future', '66:forge:past', '66:forge:as-app')), '0',
    'clock', 'neither refused clock left a run row behind');

  -- THE COLLECTION ROWS ARE THE ASSERTION. "an error was raised" would be
  -- satisfied by a failure that arrived after the erasure, and by a failure in
  -- the run that never touched this person at all.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_forge_notes
      WHERE person_id IN (v_due, v_future)), '2',
    'clock', 'after both refused clocks, every fixture collection row is still there -- the refusals cost nothing and erased nothing');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks
      WHERE retention_class = 'fixture_forge' AND state = 'deleted'), '0',
    'clock', 'and no fixture clock was marked deleted by either refused clock');

  -- THE CONTROL. The honest call -- no clock supplied, so p_now is the database
  -- default and equals now() -- does what the two refusals prevented.
  SET SESSION AUTHORIZATION retention_job;
  v_honest_got := 'not attempted';
  BEGIN
    v_run := retention.run('66:clock:honest', 'live');
    v_honest_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_honest_got := 'raised ' || SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_honest_got, 'succeeded',
    'clock', 'positive control: the same call with no clock supplied is accepted, so the refusals above are the clock guard and not a broken engine');

  -- THE SELECTION, COUNTED. This is the assertion the review asked for and the
  -- one a "did it raise?" check cannot make: the count of clocks selected whose
  -- due_at is in the future. Zero, measured on the same predicate the abuse used,
  -- and the second line is what keeps it a measurement -- the same run DID select
  -- the genuinely-due clock, so the zero above is the clock and not an empty
  -- fixture or a run that looked at nobody.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_future
        AND retention_class = 'fixture_forge'), '0',
    'clock', 'F1: the honest live run selected ZERO of the fixture clocks whose due_at is in the future');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_due
        AND retention_class = 'fixture_forge' AND action = 'deleted'), '1',
    'clock', 'F6: and it DID select and erase the clock that was genuinely due, so the count above is the clock and not an empty fixture');

  -- The future-due person is untouched in both directions: nothing selected, no
  -- state change, row present.
  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_future AND retention_class = 'fixture_forge'), 'live',
    'clock', 'the future-due clock is still live after a live run');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_forge_notes WHERE person_id = v_future), '1',
    'clock', 'and the collection row behind it is still there: a live run did not erase ahead of the due date');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_forge_notes WHERE person_id = v_due), '0',
    'clock', 'and the due person''s row is gone, because the honest call really did erase');
END $$;

-- ---------------------------------------------------------------------------
-- 66.3  F2: THE RUN IS ATTRIBUTED TO THE SESSION, NOT TO THE CALLER.
--
-- retention_runs.actor is the evidence of who erased a child's record. It was
-- the caller's string, which makes it a record the eraser wrote about itself.
--
-- Every assertion here ATTEMPTS THE ABUSE -- the caller supplies a string, and
-- the assertion is about what was stored -- rather than counting rows with a
-- non-empty actor, which the review showed cannot fail because the suite wrote
-- every one of them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_run    uuid;
  v_got    text;
  v_empty_got  text;
  v_blank_got  text;
  v_nologin_got text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- The caller names itself. Not just a nonsense label: this one is the name of
  -- a real role in this database, so an engine that stored the caller's string
  -- would produce a row that reads as though a different identity did the work.
  SET SESSION AUTHORIZATION retention_job;
  v_got := 'not attempted';
  BEGIN
    v_run := retention.run('postgres', 'live');
    v_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_got := 'raised ' || SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'succeeded',
    'attr', 'positive control: retention_job can still run, so what follows is about attribution and not about a broken engine');

  PERFORM test_support.assert_equals(
    (SELECT actor FROM retention_runs WHERE run_id = v_run), 'retention_job',
    'attr', 'F2: the run is attributed to the session that performed it');

  PERFORM test_support.assert_true(
    (SELECT actor <> 'postgres' FROM retention_runs WHERE run_id = v_run),
    'attr', 'F2: and NOT to the role name the caller supplied, which was a real role in this database');

  -- The caller's string is kept, as a label, in its own column. That is the
  -- difference between recording what the operator called the run and believing
  -- them about who ran it.
  PERFORM test_support.assert_equals(
    (SELECT actor_label FROM retention_runs WHERE run_id = v_run), 'postgres',
    'attr', 'the caller''s string is kept as actor_label, where it names the source of the run and is not read as an identity');

  -- The schema property, over every run in the table and not just this one.
  --
  -- It is deliberately NOT extended to "actor = session_user at assertion time":
  -- the runs above were authenticated as retention_job and this block is not,
  -- so that version would count every impersonated run as forged. The per-run
  -- assertions above are the ones that measure attribution; this one measures the
  -- floor the schema guarantees on top of them.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE actor IS NULL OR btrim(actor) = ''), '0',
    'attr', 'no run row in the table carries a blank or missing actor, including every row the earlier suites wrote');

  -- An EMPTY label is refused rather than accepted by NOT NULL. 22023, not
  -- 23001: this is argument validation, and the distinction from "a control
  -- stopped you" is what an operator reads a log to make.
  SET SESSION AUTHORIZATION retention_job;
  v_empty_got := 'NOT REFUSED';
  BEGIN
    PERFORM retention.run('', 'live');
  EXCEPTION WHEN OTHERS THEN v_empty_got := SQLSTATE; END;
  v_blank_got := 'NOT REFUSED';
  BEGIN
    PERFORM retention.run('   ', 'live');
  EXCEPTION WHEN OTHERS THEN v_blank_got := SQLSTATE; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_empty_got, '22023',
    'attr', 'F2: retention.run('''' ,''live'') is refused -- an empty actor is not an actor, and NOT NULL is not enough to catch it');

  PERFORM test_support.assert_equals(v_blank_got, '22023',
    'attr', 'F2: and so is a whitespace-only actor, which satisfies NOT NULL just as well');

  -- A SESSION THAT CANNOT LOG IN IS REFUSED RATHER THAN RECORDED AS NOTHING.
  -- retention_worker is NOLOGIN and holds EXECUTE, so this session really can
  -- reach the function; it is the attribution that fails, not the privilege.
  SET SESSION AUTHORIZATION retention_worker;
  v_nologin_got := 'NOT REFUSED -- an erasure would have been attributed to a credential nobody holds';
  BEGIN
    PERFORM retention.run('66:forged:nologin', 'live');
  EXCEPTION WHEN OTHERS THEN v_nologin_got := SQLSTATE; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_nologin_got, '23001',
    'attr', 'F2: a run whose session cannot log in is refused rather than attributed to nothing');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE actor_label = '66:forged:nologin'), '0',
    'attr', 'and the refused run left no row behind');
END $$;

-- ---------------------------------------------------------------------------
-- 66.4  F5: RUN TIMESTAMPS COME FROM THE DATABASE.
--
-- retention_metrics.retention_last_run_at is max(started_at) over
-- retention_runs, which is append-only and refuses DELETE. max() is monotone,
-- so ONE run stamped with a caller-supplied future instant pinned the
-- stale-job alarm at infinity permanently, and no later honest run could move
-- it back. Nothing in the table would have shown it: the row would have looked
-- exactly like every other row.
--
-- Asserted as the worker, because the worker is the identity the scheduler uses
-- and the one whose parameter used to reach the manifest.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_window interval := interval '1 day';
  v_run    uuid;
  v_faked  boolean := false;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- THE ASSERTION WITH TEETH. Made before the window count, and deliberately so.
  --
  -- The window count alone is satisfied for free once F1 holds: with a
  -- caller-supplied clock refused on a live run and defaulting to now() on a
  -- dry run, there is no value left for the caller to put there. Measured -- an
  -- earlier version of this block re-armed started_at on p_now and the suite
  -- stayed green, because the clock guard made the tamper unreachable. So this
  -- assertion aims at the property directly: a caller-supplied FORWARD instant
  -- on a dry run must move preview_instant and nothing else. Re-arm the tamper
  -- and this goes red; leave the tamper and the window count below is free
  -- because the parameter is inert, not because the assertion is weak.
  SET SESSION AUTHORIZATION retention_job;
  v_run := retention.run('66:clock:preview', 'dry_run', now() + interval '3650 days');
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_instant(
    (SELECT started_at FROM retention_runs WHERE run_id = v_run), now(),
    'clock', 'F5: a run asked about a future instant still started at the DATABASE clock, not at the instant the caller supplied');

  PERFORM test_support.assert_instant(
    (SELECT finished_at FROM retention_runs WHERE run_id = v_run), now(),
    'clock', 'F5: and finished at the database clock too');

  PERFORM test_support.assert_true(
    (SELECT preview_instant > now() + interval '3000 days' FROM retention_runs WHERE run_id = v_run),
    'clock', 'F5: the caller''s forward instant moved preview_instant, which is the only field a caller may move');

  SET SESSION AUTHORIZATION retention_job;

  -- The measurement, made from the worker -- the identity the scheduler uses and
  -- the one whose parameter used to reach the manifest. Over the WHOLE table,
  -- which includes every row suites 60 to 65 wrote: retention_runs is append-only,
  -- so this is the only place the property can be asserted for runs this suite
  -- did not make.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE started_at  < now() - v_window OR started_at  > now() + v_window
         OR finished_at < now() - v_window OR finished_at > now() + v_window), '0',
    'clock', 'F5: NO run row carries a started_at or finished_at outside a day of now(), including the rows earlier suites wrote');

  -- THE NEGATIVE CONTROL, and it is the whole reason the count above means
  -- anything. A window assertion that has never seen a value fall outside it
  -- cannot be told apart from a predicate that is always true. So: name the two
  -- forged instants the review measured and require the SAME predicate to reject
  -- them.
  PERFORM test_support.assert_true(
    ('2999-01-01'::timestamptz NOT BETWEEN now() - v_window AND now() + v_window)
    AND ('1970-01-01'::timestamptz NOT BETWEEN now() - v_window AND now() + v_window),
    'clock', 'negative control: the window predicate does reject instants outside a day of now(), so the count of zero above is a measurement and not a constant');

  -- The metric the alarm reads, named directly rather than only as a property of
  -- the table it is computed from.
  PERFORM test_support.assert_true(
    (SELECT retention_last_run_at BETWEEN now() - v_window AND now() + v_window
       FROM retention_metrics),
    'clock', 'F5: retention_last_run_at, which feeds the stale-job alarm, is inside a day of the database clock');

  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  -- And the preview instant lives in its own column, so it cannot move a metric.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE mode = 'live' AND preview_instant IS NOT NULL), '0',
    'clock', 'F5: no live run carries a preview instant at all -- a live run has no caller-supplied clock to record');

  -- -------------------------------------------------------------------------
  -- THE RESIDUAL, REPRODUCED RATHER THAN ASSUMED.
  --
  -- What this change closes is the CALLER's route to a timestamp. It does not
  -- close the OWNER's: directus_migrator owns retention_runs and can insert a row
  -- with any started_at it likes, and max() over the append-only table would then
  -- pin the stale-job alarm at that instant for ever -- exactly the failure AFC-230
  -- measured, reached by a different door.
  --
  -- That is the same residual this codebase already records for
  -- retention_clocks.state (asserted in 63.5) and for every owner-only guard
  -- trigger: the owner can disable its own control. It is bounded by the owner
  -- being a NOLOGIN role that no credential holds, which is why it is recorded
  -- rather than treated as mitigated -- and it is reproduced here so a reviewer
  -- sees it fail closed instead of being told it does.
  --
  -- Discarded subtransaction, so the alarm is intact immediately afterwards.
  BEGIN
    EXECUTE 'SET LOCAL ROLE directus_migrator';
    EXECUTE $q$INSERT INTO retention_runs (run_id, mode, status, actor, started_at, finished_at)
             VALUES (gen_random_uuid(), 'dry_run', 'succeeded', 'residual:owner-written',
                     '2999-01-01'::timestamptz, '2999-01-01'::timestamptz)$q$;
    SELECT (retention_last_run_at > now() + interval '3000 days') INTO v_faked FROM retention_metrics;
    RAISE EXCEPTION 'afc_test_support_rollback' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  PERFORM test_support.assert_true(v_faked,
    'attr', 'documented residual: the OWNER role can still write a run row with a forged started_at and pin retention_last_run_at, which is the same alarm failure reached by a different door');

  PERFORM test_support.assert_true(
    (SELECT retention_last_run_at < now() + interval '3000 days' FROM retention_metrics),
    'clock', 'after the owner probe is rolled back, retention_last_run_at is back on the database clock, so the residual is a property of the owner and not of the alarm');
END $$;

-- ---------------------------------------------------------------------------
-- 66.5  F7: A PREVIEW WRITES NOTHING.
--
-- The hold branch marked retention_clocks.state = 'held' ABOVE the mode branch,
-- so it ran in both modes: a clock at state='live' came back 'held' after one
-- dry_run. It erased nothing, which is the property that matters most, but the
-- next sync_clocks() will not move a held clock back -- a hold outranks a
-- resync by design -- so one preview could change the decision the next LIVE run
-- makes. A preview that changes a later decision is not a preview.
--
-- Asserted as the before and after SETS, not as the absence of an error: a dry
-- run that failed early would leave the state identical too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_held   uuid;
  v_before text;
  v_after  text;
  v_got    text;
  v_run    uuid;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- The held person is created HERE rather than in 66.1, because 66.2's control
  -- run is a live run and a live run marks held clocks 'held'. A fixture built
  -- before that would already read 'held' before any dry run touched it, and
  -- "the dry run did not change it" would be trivially true.
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '40 years')::date, 'active') RETURNING id INTO v_held;
  INSERT INTO fixture_persons VALUES ('forge_held', v_held);
  INSERT INTO fixture_forge_notes (person_id, body) VALUES (v_held, 'due now, but held');

  PERFORM test_support.as_role('directus_migrator',
    format($c$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
           VALUES ('person', %L::text, 'fixture hold for AFC-249 F7', gen_random_uuid())$c$,
            v_held));

  PERFORM retention.sync_clocks();

  -- Precondition on the defect being measured: the clock is DUE and NOT held
  -- before the dry run. Without this the comparison below could be satisfied by
  -- a fixture that was never a candidate for the write.
  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_held AND retention_class = 'fixture_forge'), 'due',
    'attr', 'precondition: the held fixture clock starts out due, so marking it held would be a real write');

  PERFORM test_support.assert_true(retention.has_active_hold(v_held, 'fixture_forge'),
    'attr', 'precondition: and it really is under an active legal hold, so the run reaches the hold branch');

  -- The whole table, one fingerprint. Computed by the owner here and re-computed
  -- the same way below, so the comparison is over the same bytes.
  SELECT md5(coalesce(string_agg(rc.id::text || ':' || rc.state, ',' ORDER BY rc.id), '(none)'))
    INTO v_before FROM retention_clocks rc;

  PERFORM test_support.assert_true(v_before IS NOT NULL,
    'attr', 'precondition: there are clocks to fingerprint');

  -- And a probe control on the fingerprint itself, so "byte-identical" is not a
  -- comparison of two empty strings. One clock that differs has to change it.
  PERFORM test_support.assert_true(
    v_before <> md5('anything else at all'),
    'attr', 'probe control: the fingerprint changes when the input changes, so the comparison below is a measurement and not two equal constants');

  -- A dry run with a live hold on the fixture person above, so the hold branch
  -- is definitely reached by this run.
  SET SESSION AUTHORIZATION retention_job;
  v_got := 'not attempted';
  BEGIN
    v_run := retention.run('66:preview:write', 'dry_run');
    v_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN v_got := 'raised ' || SQLSTATE || ' ' || SQLERRM; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'succeeded',
    'attr', 'positive control: the dry run really did execute, so the state comparison below is about what it did');

  -- The hold is still REPORTED. A preview that stopped reporting holds would be
  -- a smaller change than the one that has to be undone.
  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(skip_reason, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_held), 'held',
    'attr', 'F7: the dry run still reports the hold as the reason it would skip');

  -- THE MEASUREMENT. Byte-identical before and after, over every clock.
  SELECT md5(coalesce(string_agg(rc.id::text || ':' || rc.state, ',' ORDER BY rc.id), '(none)'))
    INTO v_after FROM retention_clocks rc;

  PERFORM test_support.assert_equals(v_after, v_before,
    'attr', 'F7: a dry_run left retention_clocks.state byte-identical -- every clock, every state');

  -- And the specific clock the review measured, named rather than counted.
  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_held AND retention_class = 'fixture_forge'), 'due',
    'attr', 'F7: the held fixture clock is still due, not marked held by a preview');

  -- A LIVE run does mark it. If this did not fire, the assertion above would be
  -- satisfied by a hold branch that had been deleted rather than moved -- and
  -- "the preview does not write" is only meaningful while the live run still
  -- does.
  SET SESSION AUTHORIZATION retention_job;
  v_got := 'not attempted';
  BEGIN
    v_run := retention.run('66:preview:live', 'live');
    v_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN v_got := 'raised ' || SQLSTATE || ' ' || SQLERRM; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'succeeded',
    'attr', 'positive control: a live run over the same fixture is accepted');

  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_held AND retention_class = 'fixture_forge'), 'held',
    'attr', 'F7: and a LIVE run does mark the clock held, so the dry-run assertion above is about the mode and not about a missing write');
END $$;

-- ---------------------------------------------------------------------------
-- 66.6  F7: A PREVIEW CLOCK IS HONOURED FORWARD AND REFUSED BACKWARD.
--
-- THE INTENDED BEHAVIOUR IS PINNED HERE, IN THE NAMES, so this suite cannot be
-- read as merely recording whatever the code happens to do:
--
--   INTENDED: retention.run(..., 'dry_run', <a future instant>) IS ACCEPTED and
--             its selection moves forward with it. A preview is how an operator
--             asks "what would this erase in a year", and a control that cannot
--             answer that is a control that can only tell you what is already
--             overdue.
--
--   INTENDED: retention.run(..., 'dry_run', <an instant before now()>) is
--             REFUSED. A 1970 preview reported zero candidates for a schedule
--             that had thirty. A preview that under-reports is the same
--             over-retention failure as a live run with a forged past clock,
--             wearing a read-only hat.
--
-- The forward case is asserted by MEASURING THE DIFFERENCE, not by "it did not
-- raise": the future-due clock that the honest run at now() did not select is
-- selected by the forward preview.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_future uuid;
  v_now_run uuid;
  v_fwd_run uuid;
  v_past_got text;
  v_fwd_got text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';
  SELECT person_id INTO v_future FROM fixture_persons WHERE label = 'forge_future_due';

  -- THE MEASURED BASELINE: a preview at the database clock does not select the
  -- future-due clock. Counted, not asserted-absent.
  SET SESSION AUTHORIZATION retention_job;
  v_fwd_got := 'not attempted';
  BEGIN
    v_now_run := retention.run('66:preview:at-now', 'dry_run');
    v_fwd_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN v_fwd_got := 'raised ' || SQLSTATE || ' ' || SQLERRM; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_fwd_got, 'succeeded',
    'preview', 'positive control: a dry run with no clock supplied is accepted');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_now_run AND person_id = v_future
        AND retention_class = 'fixture_forge'), '0',
    'preview', 'baseline: a preview at the database clock selects none of the future-due fixture clocks');

  -- INTENDED AND ASSERTED: forward is accepted, and it changes the selection.
  SET SESSION AUTHORIZATION retention_job;
  v_fwd_got := 'NOT ACCEPTED';
  BEGIN
    v_fwd_run := retention.run('66:preview:forward', 'dry_run', now() + interval '3650 days');
    v_fwd_got := 'succeeded';
  EXCEPTION WHEN OTHERS THEN v_fwd_got := 'raised ' || SQLSTATE || ' ' || SQLERRM; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_fwd_got, 'succeeded',
    'preview', 'INTENDED: a dry run with a FORWARD-supplied clock is accepted -- a preview is how an operator asks what would be erased later');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_fwd_run AND person_id = v_future
        AND retention_class = 'fixture_forge' AND action = 'would_delete'), '1',
    'preview', 'and the forward preview really did select the future-due clock the baseline preview did not, so the forward clock is honoured rather than ignored');

  -- And the forward instant is recorded where it cannot move a metric.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE run_id = v_fwd_run AND preview_instant > now()), '1',
    'preview', 'the forward instant is recorded in preview_instant, its own column');

  PERFORM test_support.assert_true(
    (SELECT preview_instant IS NOT DISTINCT FROM started_at FROM retention_runs WHERE run_id = v_now_run),
    'preview', 'and a preview at the database clock records the same instant in preview_instant as in started_at, which is what "no clock supplied" means');

  -- Nothing was erased by any of it, and the states are still what 66.5 left.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_forge_notes WHERE person_id = v_future), '1',
    'preview', 'INTENDED: the forward preview erased nothing -- a preview that erased would not be a preview');

  -- INTENDED AND ASSERTED: backward is refused.
  SET SESSION AUTHORIZATION retention_job;
  v_past_got := 'NOT REFUSED';
  BEGIN
    PERFORM retention.run('66:preview:backward', 'dry_run', '1970-01-01'::timestamptz);
  EXCEPTION WHEN OTHERS THEN v_past_got := SQLSTATE; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_past_got, '23001',
    'preview', 'INTENDED: a dry run with a clock BEFORE now() is refused -- a preview anchored in the past under-reports records that are already due');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE actor_label = '66:preview:backward'), '0',
    'preview', 'and the refused backward preview left no run row behind');
END $$;

-- ---------------------------------------------------------------------------
-- 66.7  F3: THE ONLY IDENTITY THAT CAN RELEASE A HOLD IS THE ONE WHOSE
--       ATTRIBUTION THE DATABASE DERIVES.
--
-- 63.4 owns the behavioural half of the release -- unmapped refused, mapped
-- stored, and never the uuid the caller supplied. What belongs here is the
-- boundary: the worker that performs erasure is not an identity that may lift
-- the hold that stops it.
--
-- That is not a formality. The erasure capability and the release capability
-- are deliberately different grants (ADR-0004 keeps identity and capability
-- separate), and a job that could both erase and unblock itself would not have
-- a hold in front of it at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_got    text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- As a probe first: the grant list. retention_worker holds no EXECUTE on
  -- release_hold, so this never reaches the attribution logic.
  PERFORM test_support.assert_raises('retention_worker',
    $q$SELECT retention.release_hold(gen_random_uuid())$q$,
    '42501', 'attr', 'the erasure worker holds no grant on release_hold: refused by the grant list');

  -- And authenticated as, which is the same claim made the only way that means
  -- anything: a session whose credentials really are the worker's.
  SET SESSION AUTHORIZATION retention_worker;
  v_got := 'NOT REFUSED';
  BEGIN
    PERFORM retention.release_hold(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_got := SQLSTATE; END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, '42501',
    'attr', 'and authenticated as the worker it is still refused: a job that erases cannot also lift the hold that stops it');

  PERFORM test_support.assert_equals(current_user, v_holder,
    'attr', 'the harness session identity is restored at the end of the suite too');
END $$;