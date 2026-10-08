-- tests/db/69_retention_evidence_run.sql
--
-- AFC-320. THE §0.10.5 EVIDENCE-RUN BUNDLE.
--
-- WHAT THIS FILE IS. A repeatable bundle that demonstrates ONE real scheduled
-- deletion executed through the constrained erasure credential, with the
-- deletion logged in the manifest. Runnable now on PGlite, runnable UNCHANGED
-- against a real postgres:16 server via PG_URL later. The parent (AFC-267)
-- owns environment provisioning and sign-off; this file is the executable
-- evidence it will run.
--
-- RELATION TO 67. Suite 67 proved a live erasure as retention_job with a
-- directus_app negative control. This suite is the evidence bundle built on
-- that technique, and it adds what the §0.10.5 gate needs beyond 67:
--
--   * a HELD-CLOCK negative control: a second due fixture under an active
--     legal hold survives the same live run that erases the first, with a
--     manifest item recording action='skipped', skip_reason='held'. A bundle
--     that erases everything in reach cannot tell "the schedule selected this
--     row" from "the job deletes whatever it sees".
--   * machine-readable manifest capture: the run header and both items are
--     emitted as AFC_EVIDENCE/1 notices (see 69.5), so the parent can lift the
--     exact rows into the gate record without re-reading them by label.
--
-- WHAT IS ASSERTED
--   69.1  fixtures and preconditions: the policy row is the one the system
--         holds (inserted idempotently, never assumed); both clocks are
--         genuinely due under it; the policy is active with live erasure
--         enabled; exactly one erasure-target row waits per person; the due
--         person is under no hold and the control person is.
--   69.2  the session really is retention_job and really is not a superuser,
--         and the LIVE call returns a run id.
--   69.3  the due row is gone AND the manifest records action='deleted' AND
--         the run is recorded succeeded in live mode with actor='retention_job'
--         (the session) and the scheduler string as label only. The person row
--         survives (D3).
--   69.4  THE HELD CONTROL: the held row survives, its manifest item reads
--         skipped/held, and its clock reads 'held'.
--   69.5  the manifest rows are emitted as evidence notices (no assertions;
--         the harness ledger ignores non-assertion notices by design).
--
-- SYNTHETIC FIXTURES ONLY. No real personal data anywhere in this bundle.
-- The bodies below are labels, not records.
--
-- THE ONLY ERASURE PATH is retention.run(<scheduler label>, 'live') executed
-- as retention_job. No direct DELETE, no superuser-driven live call, no
-- caller-supplied clock: the two-argument call takes its selection instant
-- from the database, and the fixture clocks are due under the policy row the
-- system actually holds (asserted in 69.1, not arranged by hand).
--
-- IMPERSONATION. SET SESSION AUTHORIZATION, never SET ROLE from a superuser
-- session -- suite 67's header records the measurement that SET ROLE from a
-- superuser session proves nothing. Restore names the harness identity
-- explicitly (per the 67 convention): RESET SESSION AUTHORIZATION is a no-op
-- in PGlite 0.2.17 while naming the role is correct under PGlite and harmless
-- on a real server.
--
-- PG_URL-READINESS. Nothing here is PGlite-only: no absolute dates (every
-- fixture instant is relative to now()), no rendering comparisons (due-ness is
-- asserted as an instant predicate, per AFC-202), no RESET SESSION
-- AUTHORIZATION, no PGlite-only function. The policy insert is
-- ON CONFLICT DO NOTHING on (rule_key, version), so the bundle neither
-- depends on suite 61 having run nor creates a second active rule. Its own
-- persons, its own target rows, its own hold: no other suite's fixture is
-- reused and none is modified.
--
-- REVIEW GATE. tests/db/** is on REVIEW_REQUIRED_PATHS: this file ships with
-- an R1 authorship claim (.provenance/claims/AFC-320.json) and needs a
-- non-author Reviewed-by trailer before the R2 gate is clear.

-- ---------------------------------------------------------------------------
-- 69.1  FIXTURE AND PRECONDITIONS.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder  text;
  v_due     uuid;
  v_held    uuid;
  v_due_at  timestamptz;
  v_held_at timestamptz;
  v_rows    integer;
BEGIN
  -- Suite order defended: do not inherit whatever identity the suite before left.
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(current_user, v_holder,
    'evidence', 'precondition: this block starts as the harness identity, not as whatever an earlier suite left behind');

  -- The schedule the system actually holds. Idempotent: the same
  -- (rule_key, version) 61 creates, so this bundle does not depend on 61
  -- having run and still cannot create a second active rule for the class.
  INSERT INTO retention_policies
    (rule_key, retention_class, version, effective_from,
     anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
  VALUES ('fixture.medical', 'fixture_medical', 1, now() - interval '1 day',
          'fixture_case_closed_at', 1, 'whichever_later', '["identified"]'::jsonb, true, true)
  ON CONFLICT (rule_key, version) DO NOTHING;

  -- Two persons: one the schedule will erase, one a legal hold will spare.
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_due;
  INSERT INTO fixture_persons VALUES ('evd_due_person', v_due);

  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_held;
  INSERT INTO fixture_persons VALUES ('evd_held_person', v_held);

  INSERT INTO fixture_medical_notes (person_id, body)
  VALUES (v_due, 'AFC-320 evidence run: the row the schedule erases'),
         (v_held, 'AFC-320 evidence run: the row the hold spares');

  -- The closed concerns are what make both clocks computable at all. Without
  -- them the clocks are indeterminate and everything below would be satisfied
  -- by fixtures that were never erasable in the first place. Three years ago
  -- against a one-year floor: genuinely due under the policy row above, with
  -- no hand-set clock anywhere.
  INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
  VALUES (v_due, now() - interval '3 years'),
         (v_held, now() - interval '3 years');

  -- The control's hold: person-scoped, active, on the control person only.
  INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
  VALUES ('person', v_held::text, 'AFC-320 evidence run: the hold that must win', gen_random_uuid());

  -- Drive the clocks as the session role. The job calls sync_clocks before it
  -- calls run; this is that call, not a fixture shortcut.
  PERFORM retention.sync_clocks();

  SELECT due_at INTO v_due_at FROM retention_clocks
   WHERE person_id = v_due AND retention_class = 'fixture_medical';
  SELECT due_at INTO v_held_at FROM retention_clocks
   WHERE person_id = v_held AND retention_class = 'fixture_medical';

  -- Asserted as INSTANTS, not renderings, so the assertions do not depend on
  -- the session TimeZone (AFC-202).
  PERFORM test_support.assert_true(
    v_due_at IS NOT NULL AND v_due_at <= now(),
    'evidence', 'precondition: the erasure fixture clock is genuinely due under the held policy, not indeterminate and not in the future');

  PERFORM test_support.assert_true(
    v_held_at IS NOT NULL AND v_held_at <= now(),
    'evidence', 'precondition: the control fixture clock is genuinely due too, so its survival is the hold and not the schedule');

  PERFORM test_support.assert_true(
    (SELECT is_active AND delete_enabled FROM retention_policies
      WHERE rule_key = 'fixture.medical' AND version = 1),
    'evidence', 'precondition: the class policy is active with live erasure enabled, so a surviving due row is a failure and not a policy');

  PERFORM test_support.assert_true(
    NOT retention.has_active_hold(v_due, 'fixture_medical'),
    'evidence', 'precondition: no hold is in force on the erasure fixture, so what follows is not a hold test wearing a live-run label');

  PERFORM test_support.assert_true(
    retention.has_active_hold(v_held, 'fixture_medical'),
    'evidence', 'precondition: the control fixture really is under an active legal hold, so its survival tests the hold branch');

  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_due;
  PERFORM test_support.assert_equals(v_rows::text, '1',
    'evidence', 'precondition: exactly one row of THIS bundle''s erasure fixture is waiting to be erased');

  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_held;
  PERFORM test_support.assert_equals(v_rows::text, '1',
    'evidence', 'precondition: exactly one row of THIS bundle''s control fixture is waiting to be spared');
END $$;

-- ---------------------------------------------------------------------------
-- 69.2  THE LIVE ERASURE, AS retention_job.
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
  v_due    uuid;
  v_held   uuid;
  v_rows   integer := -1;
  v_action text;
  v_skip   text;
  v_status text;
  v_mode   text;
  v_actor  text;
  v_label  text;
BEGIN
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  SELECT person_id INTO v_due FROM fixture_persons WHERE label = 'evd_due_person';
  SELECT person_id INTO v_held FROM fixture_persons WHERE label = 'evd_held_person';

  SET SESSION AUTHORIZATION retention_job;
  SELECT current_user, (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)
    INTO v_who, v_super;

  -- The two preconditions of the technique, asserted rather than trusted. A
  -- superuser wearing the role's name would satisfy every assertion below and
  -- prove nothing.
  PERFORM test_support.assert_equals(v_who, 'retention_job',
    'evidence', 'precondition: the session is the ordinary LOGIN identity the scheduler connects as');

  PERFORM test_support.assert_equals(v_super, 'false',
    'evidence', 'precondition: that identity is NOT a superuser, so the erasure below cannot be a superuser override');

  -- THE CALL. 'scheduler:retention-nightly' names the source of the run. It is
  -- the caller's label; 69.3 asserts it is not what attribution reads. Two
  -- arguments: the selection instant is the database's own clock, never a
  -- caller-supplied one.
  v_run := retention.run('scheduler:retention-nightly', 'live');

  -- Back to the harness identity BEFORE reading anything. The evidence is
  -- gathered by a role that can see the erasure target, rather than by the
  -- identity whose view of it is part of what is being tested.
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_true(v_run IS NOT NULL,
    'evidence', 'the LIVE call as retention_job returned a run id');

  -- 69.3. THE DELETION.
  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_due;
  PERFORM test_support.assert_equals(v_rows::text, '0',
    'evidence', 'a LIVE run as retention_job ACTUALLY REMOVED the due row (count 1 -> 0), so this is not a dry run reporting success');

  -- The manifest is the evidence. 'would_delete' here, with 0 rows on the
  -- table, would mean the run deleted nothing and reported nothing honest.
  SELECT action::text, skip_reason::text INTO v_action, v_skip FROM retention_run_items
   WHERE run_id = v_run AND person_id = v_due AND retention_class = 'fixture_medical';
  PERFORM test_support.assert_equals(v_action, 'deleted',
    'evidence', 'the manifest records action=deleted for the erased fixture, so the evidence agrees with the row count');
  PERFORM test_support.assert_equals(coalesce(v_skip, '(null)'), '(null)',
    'evidence', 'and the acted-on item carries no skip reason');

  SELECT status::text, mode::text INTO v_status, v_mode FROM retention_runs WHERE run_id = v_run;
  PERFORM test_support.assert_equals(v_status, 'succeeded',
    'evidence', 'the run is recorded as succeeded');
  PERFORM test_support.assert_equals(v_mode, 'live',
    'evidence', 'and the run really ran in live mode');

  -- NDPA s.40(2): attribution is the session, not the caller's string.
  SELECT actor, actor_label INTO v_actor, v_label FROM retention_runs WHERE run_id = v_run;
  PERFORM test_support.assert_equals(v_actor, 'retention_job',
    'evidence', 'the erasure is attributed to the SESSION identity, which is the s.40(2) evidence');

  -- And the scheduler string really did land in the label column, so the
  -- assertion above is not passing on an empty string.
  PERFORM test_support.assert_equals(v_label, 'scheduler:retention-nightly',
    'evidence', 'the scheduler''s own words are recorded as a LABEL and are not the attribution');

  -- D3: the person row is NOT deleted. A category erasure that took the person
  -- with it would be the "delete the person" job the design forbids.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM people WHERE id = v_due), '1',
    'evidence', 'D3: erasing the category did not erase the person');

  -- 69.4. THE HELD CONTROL: the same live run spared the held row.
  SELECT count(*) INTO v_rows FROM fixture_medical_notes WHERE person_id = v_held;
  PERFORM test_support.assert_equals(v_rows::text, '1',
    'evidence', 'control: the held row survived the SAME live run that erased the due row, so the hold outranks the schedule');

  SELECT action::text, skip_reason::text INTO v_action, v_skip FROM retention_run_items
   WHERE run_id = v_run AND person_id = v_held AND retention_class = 'fixture_medical';
  PERFORM test_support.assert_equals(v_action, 'skipped',
    'evidence', 'control: the manifest records the control item as skipped, not acted on');
  PERFORM test_support.assert_equals(v_skip, 'held',
    'evidence', 'control: and the reason it gives is the hold');

  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_held AND retention_class = 'fixture_medical'), 'held',
    'evidence', 'control: the held clock reads held after the run');

  INSERT INTO fixture_persons VALUES ('evd_run_id', v_run);

  PERFORM test_support.assert_equals(current_user, v_holder,
    'evidence', 'the harness session identity is restored after the live block');
END $$;

-- ---------------------------------------------------------------------------
-- 69.5  MANIFEST-ROW CAPTURE.
--
-- No assertions. The run header and the two items this bundle produced are
-- emitted as AFC_EVIDENCE/1 notices -- column names plus values, plus what
-- each proves -- so the §0.10.5 gate record can quote the exact rows without
-- re-reading them by the untrusted label. The harness ledger ignores
-- non-assertion notices by design (scripts/run-db-tests.mjs parses only the
-- AFC_ASSERT/1 marker), so this block cannot turn a run green or red; a
-- capture script that runs this same file reads these lines off the notice
-- stream. Fixture labels are resolved to ids first, so a missing fixture
-- fails loudly here instead of emitting an empty capture.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_run    uuid;
  v_due    uuid;
  v_held   uuid;
  r        record;
BEGIN
  SELECT v INTO v_holder FROM test_support.config WHERE k = 'session_role';
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  SELECT person_id INTO v_run FROM fixture_persons WHERE label = 'evd_run_id';
  SELECT person_id INTO v_due FROM fixture_persons WHERE label = 'evd_due_person';
  SELECT person_id INTO v_held FROM fixture_persons WHERE label = 'evd_held_person';

  IF v_run IS NULL OR v_due IS NULL OR v_held IS NULL THEN
    RAISE EXCEPTION 'evidence capture refused: a fixture label did not resolve (run=%, due=%, held=%)',
      v_run, v_due, v_held USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO r FROM retention_runs WHERE run_id = v_run;
  RAISE NOTICE 'AFC_EVIDENCE/1 %', json_build_object(
    'row', 'retention_runs',
    'run_id', r.run_id::text,
    'mode', r.mode,
    'status', r.status,
    'actor', r.actor,
    'actor_label', r.actor_label,
    'started_at_utc', to_char(r.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    'finished_at_utc', to_char(r.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    'counts', r.counts,
    'proves', 'one live run by the retention_job session; actor is the session (attribution), actor_label is the scheduler string (label only)'
  )::text;

  SELECT * INTO r FROM retention_run_items
   WHERE run_id = v_run AND person_id = v_due AND retention_class = 'fixture_medical';
  RAISE NOTICE 'AFC_EVIDENCE/1 %', json_build_object(
    'row', 'retention_run_items',
    'run_id', r.run_id::text,
    'person_label', 'evd_due_person',
    'person_id', r.person_id::text,
    'retention_class', r.retention_class,
    'policy_version', r.policy_version,
    'due_at_utc', to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    'action', r.action,
    'skip_reason', r.skip_reason,
    'proves', 'the due fixture was erased on schedule: action=deleted with no skip reason, and the target row count went 1 -> 0'
  )::text;

  SELECT * INTO r FROM retention_run_items
   WHERE run_id = v_run AND person_id = v_held AND retention_class = 'fixture_medical';
  RAISE NOTICE 'AFC_EVIDENCE/1 %', json_build_object(
    'row', 'retention_run_items',
    'run_id', r.run_id::text,
    'person_label', 'evd_held_person',
    'person_id', r.person_id::text,
    'retention_class', r.retention_class,
    'policy_version', r.policy_version,
    'due_at_utc', to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
    'action', r.action,
    'skip_reason', r.skip_reason,
    'proves', 'the held fixture survived the same run: action=skipped with skip_reason=held, and the target row count stayed 1'
  )::text;
END $$;
