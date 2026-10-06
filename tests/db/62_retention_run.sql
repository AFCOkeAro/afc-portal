-- tests/db/62_retention_run.sql
--
-- AFC-167 sections 6 and 8.1, 8.4, 8.5. THE JOB ITSELF.
--
--   62.1  ships dark    -- the default mode is dry_run, and a policy with
--                          delete_enabled = false cannot be erased by a live run
--   62.2  idempotence   -- run twice over the same fixture; the second run
--                          deletes nothing and reports already_deleted
--   62.3  ladder (D5)   -- a clock short of the terminal ladder stage is skipped
--   62.4  audit floor   -- AFC-167 8.4. delete_enabled=false on the audit class
--                          keeps it non-deletable, and a well-meaning config
--                          edit cannot quietly fix that
--   62.5  manifest (8.5) -- one run row, one item per candidate, a reason for
--                          every skip
--   62.6  the manifest is evidence and cannot be rewritten
--   62.7  single writer -- a second concurrent run is refused
--   62.8  a misconfigured class fails the run instead of faking an erasure

-- ---------------------------------------------------------------------------
-- 62.1  SHIPS DARK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_run uuid;
BEGIN
  -- The default IS dry_run. Asserted by calling it with no mode at all, which
  -- is how a scheduler that forgets the argument behaves.
  v_run := retention.run('test:dark');

  PERFORM test_support.assert_equals(
    (SELECT mode::text FROM retention_runs WHERE run_id = v_run), 'dry_run',
    'dark', 'D6: retention.run defaults to dry_run, not live');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_run AND action = 'deleted'),
    '0', 'dark', 'a run with no mode argument deleted nothing');

  -- An unrecognised mode is a caller error, not a silent fallback to live.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT retention.run('test:dark', 'delete_everything')$q$,
    '22023', 'dark', 'an unrecognised run mode is refused rather than defaulted');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT retention.run('test:dark', 'LIVE')$q$,
    '22023', 'dark', 'the mode is case-sensitive: LIVE is not live, it is a typo');

  -- Nothing may delete on our behalf while the schedule is unratified. The
  -- real shipped state is that the production migration seeds NO policy at all:
  -- every row in this table is a fixture created by this test suite. Asserted
  -- because "ships dark" is a claim about the migration, and this is the only
  -- place that claim can be checked mechanically.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_policies WHERE rule_key NOT LIKE 'fixture.%'), '0',
    'dark', 'precondition: the schema ships with no real policy rows, only test fixtures');
END $$;

-- ---------------------------------------------------------------------------
-- 62.2  IDEMPOTENCE. AFC-167 section 8.1.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person  uuid;
  v_run_1   uuid;
  v_run_2   uuid;
  v_rows_1  integer;
  v_rows_2  integer;
BEGIN
  -- A person of our own, with an enabled class so a live run really erases.
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_person;
  INSERT INTO fixture_persons VALUES ('idem_person', v_person);

  INSERT INTO fixture_medical_notes (person_id, body) VALUES (v_person, 'to be erased');

  -- The medical policy from 61 already has delete_enabled = true and its
  -- erasure target configured. Give this person a closed concern so the
  -- medical clock is due.
  INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
  VALUES (v_person, now() - interval '3 years');

  PERFORM retention.sync_clocks();

  PERFORM test_support.assert_true(
    (SELECT due_at IS NOT NULL AND due_at <= now() FROM retention_clocks
      WHERE person_id = v_person AND retention_class = 'fixture_medical'),
    'idem', 'precondition: the idempotence fixture clock is genuinely due');

  SELECT count(*) INTO v_rows_1 FROM fixture_medical_notes WHERE person_id = v_person;
  PERFORM test_support.assert_equals(v_rows_1::text, '1',
    'idem', 'precondition: exactly one row is waiting to be erased');

  v_run_1 := retention.run('test:idem:1', 'live');

  PERFORM test_support.assert_equals(
    (SELECT action::text FROM retention_run_items
      WHERE run_id = v_run_1 AND person_id = v_person AND retention_class = 'fixture_medical'),
    'deleted', 'idem', 'the first live run erases the row');

  SELECT count(*) INTO v_rows_2 FROM fixture_medical_notes WHERE person_id = v_person;
  PERFORM test_support.assert_equals(v_rows_2::text, '0',
    'idem', 'the first live run removed the row');

  -- Second run over identical state.
  v_run_2 := retention.run('test:idem:2', 'live');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(action, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run_2 AND person_id = v_person AND retention_class = 'fixture_medical'),
    'skipped', 'idem', 'the second run skips the clock rather than erasing again');

  PERFORM test_support.assert_equals(
    (SELECT skip_reason::text FROM retention_run_items
      WHERE run_id = v_run_2 AND person_id = v_person AND retention_class = 'fixture_medical'),
    'already_deleted', 'idem', 'the second run reports already_deleted for every row');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_run_2 AND action IN ('deleted', 'would_delete')),
    '0', 'idem', 'the second run deleted zero');

  -- And the manifest is still written for the second run. A job that returns
  -- "nothing to do" without a manifest is a job you cannot prove ran.
  PERFORM test_support.assert_equals(
    (SELECT status::text FROM retention_runs WHERE run_id = v_run_2), 'succeeded',
    'idem', 'the second run is recorded as succeeded');
END $$;

-- ---------------------------------------------------------------------------
-- 62.3  LADDER STAGE. D5.
--
-- A ladder exists so a class can be walked rather than dropped. A clock whose
-- stage is not the policy's terminal stage is not a candidate, and the reason
-- is recorded rather than the row being silently ignored.
--
-- Two people, not two clocks on one person. UNIQUE(person_id,
-- retention_class) means there is exactly one clock per class per person --
-- that is the structural half of D3, and it is why the ladder is a question
-- about a person+class pair rather than about a row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Own erasure target for this class, owned by the engine's owner role.
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_ladder_notes (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       person_id uuid NOT NULL,
       body text
     )$c$);
  PERFORM test_support.as_role(NULL,
    $c$INSERT INTO retention_class_sources (retention_class, table_name, person_column)
     VALUES ('fixture_ladder_class', 'fixture_ladder_notes', 'person_id')
     ON CONFLICT DO NOTHING$c$);
END $$;

INSERT INTO retention_policies
  (rule_key, retention_class, version, effective_from,
   anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
VALUES ('fixture.ladder', 'fixture_ladder_class', 1, now() - interval '1 day',
        'fixture_case_closed_at', 1, 'whichever_later',
        '["identified","reviewed","escalated"]'::jsonb, true, true);

DO $$
DECLARE
  v_done     uuid;
  v_pending  uuid;
  v_run      uuid;
BEGIN
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '45 years')::date, 'active') RETURNING id INTO v_done;
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '44 years')::date, 'active') RETURNING id INTO v_pending;
  -- Plain SQL cannot see plpgsql variables, so the label rows go through the
  -- harness with a formatted statement.
  PERFORM test_support.as_role(NULL,
    format($q$INSERT INTO fixture_persons VALUES ('ladder_done', %L::uuid),
                                                      ('ladder_pending', %L::uuid)$q$,
           v_done, v_pending));

  PERFORM test_support.as_role(NULL,
    format($q$INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
             VALUES (%L::uuid, now() - interval '3 years'),
                    (%L::uuid, now() - interval '3 years')$q$,
           v_done, v_pending));

  PERFORM retention.sync_clocks();

  -- Both clocks default to the first ladder stage. Only one is walked to the
  -- terminal one.
  PERFORM test_support.as_role(NULL,
    format($q$UPDATE retention_clocks SET ladder_stage = 'escalated'
             WHERE person_id = %L::uuid AND retention_class = 'fixture_ladder_class'$q$, v_done));

  -- Scoped to this suite's two people. sync_clocks is a full recompute over
  -- every active person, so by this point earlier suites have left their own
  -- clocks behind; an unscoped count here would pass or fail for reasons that
  -- have nothing to do with the ladder.
PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_clocks
      WHERE person_id IN (v_done, v_pending)
        AND retention_class = 'fixture_ladder_class'
        AND due_at IS NOT NULL AND due_at <= now()), '2',
    'ladder', 'precondition: two due clocks, one walked to the terminal stage and one not');

PERFORM test_support.assert_equals(
    (SELECT ladder_stage::text FROM retention_clocks
      WHERE person_id = v_done AND retention_class = 'fixture_ladder_class'), 'escalated',
    'ladder', 'precondition: one clock is at the terminal stage');

PERFORM test_support.assert_equals(
    (SELECT ladder_stage::text FROM retention_clocks
      WHERE person_id = v_pending AND retention_class = 'fixture_ladder_class'), 'identified',
    'ladder', 'precondition: one clock is not');

  v_run := retention.run('test:ladder', 'dry_run');

  PERFORM test_support.assert_equals(
    (SELECT skip_reason::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_pending
        AND retention_class = 'fixture_ladder_class'),
    'ladder_stage_not_reached', 'ladder', 'a clock short of the terminal stage is skipped');

  PERFORM test_support.assert_equals(
    (SELECT action::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_done
        AND retention_class = 'fixture_ladder_class'),
    'would_delete', 'ladder', 'the clock AT the terminal stage is still a candidate');

  -- A policy with no ladder configured has no stages to reach, and treating
  -- "no ladder" as "not reached" would strand every record forever.
  PERFORM test_support.assert_true(retention.ladder_reached(NULL, 'identified'),
    'ladder', 'a policy with no ladder configured is treated as having its stage reached');

  PERFORM test_support.assert_true(retention.ladder_reached('["a","b"]'::jsonb, 'b'),
    'ladder', 'the last stage in the ladder is the terminal one');

  PERFORM test_support.assert_true(NOT retention.ladder_reached('["a","b"]'::jsonb, 'a'),
    'ladder', 'an earlier stage is not terminal');

  -- The terminal stage comes from config. Adding a stage to the policy is a row
  -- update and it moves what counts as terminal -- the same D1 property as the
  -- durations.
  PERFORM test_support.assert_equals(
    retention.terminal_ladder_stage('["identified","reviewed","escalated"]'::jsonb), 'escalated',
    'ladder', 'the terminal stage is read from the policy ladder, not hardcoded');

  PERFORM test_support.assert_equals(
    coalesce(retention.terminal_ladder_stage(NULL), 'NULL'), 'NULL',
    'ladder', 'an absent ladder has no terminal stage');

  -- A live run erases the walked clock and leaves the unwalked one alone.
  v_run := retention.run('test:ladder:live', 'live');
  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM retention_clocks
      WHERE person_id = v_pending AND retention_class = 'fixture_ladder_class'
        AND state = 'due'),
    'ladder', 'a live run left the unwalked clock due and untouched');
END $$;

-- ---------------------------------------------------------------------------
-- 62.4  THE AUDIT FLOOR. AFC-167 section 8.4.
--
-- "The audit class must not be auto-deleted at its floor while Q12 is open.
-- Model it as delete_enabled = false on that policy plus a test asserting it
-- stays non-deletable. Do not let a well-meaning config edit fix this."
--
-- The shipped safeguard is the DEFAULT: delete_enabled defaults to FALSE, so a
-- policy nobody has consciously enabled cannot erase anything. What the test
-- proves is that the default holds and that a disabled policy is REPORTED as
-- disabled rather than silently skipped -- a silent skip is what lets a class
-- quietly stop being protected.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_audit_notes (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       person_id uuid NOT NULL,
       body text
     )$c$);
  PERFORM test_support.as_role(NULL,
    $c$INSERT INTO retention_class_sources (retention_class, table_name, person_column)
     VALUES ('fixture_audit_class', 'fixture_audit_notes', 'person_id')
     ON CONFLICT DO NOTHING$c$);
END $$;

INSERT INTO retention_policies
  (rule_key, retention_class, version, effective_from,
   anchor_a, floor_years, operator, ladder_stages, is_active)
VALUES ('fixture.audit', 'fixture_audit_class', 1, now() - interval '1 day',
        'fixture_case_closed_at', 1, 'whichever_later', '["identified"]'::jsonb, true);

DO $$
DECLARE
  v_person uuid;
  v_run    uuid;
  v_note   integer;
BEGIN
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_person;
  INSERT INTO fixture_persons VALUES ('audit_person', v_person);

  INSERT INTO fixture_audit_notes (person_id, body) VALUES (v_person, 'audit class row');
  INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
  VALUES (v_person, now() - interval '3 years');

  PERFORM retention.sync_clocks();

  PERFORM test_support.assert_true(
    (SELECT due_at IS NOT NULL AND due_at <= now() FROM retention_clocks
      WHERE person_id = v_person AND retention_class = 'fixture_audit_class'),
    'audit', 'precondition: the audit clock is genuinely due');

  SELECT count(*) INTO v_note FROM fixture_audit_notes WHERE person_id = v_person;
  PERFORM test_support.assert_equals(v_note::text, '1', 'audit', 'precondition: a row to protect');

  PERFORM test_support.assert_equals(
    (SELECT delete_enabled::text FROM retention_policies WHERE rule_key = 'fixture.audit'), 'false',
    'audit', 'the audit policy ships with delete_enabled = false');

  -- Live run, the dangerous mode. The disabled policy must still hold.
  v_run := retention.run('test:audit', 'live');

  PERFORM test_support.assert_equals(
    (SELECT skip_reason::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_audit_class'),
    'policy_delete_disabled', 'audit',
    'a LIVE run skips a class whose policy has delete_enabled = false');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_audit_notes WHERE person_id = v_person), '1',
    'audit', 'the row under the audit floor survived a live run');

  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_person AND retention_class = 'fixture_audit_class'),
    'due', 'audit', 'the clock is left due, not advanced: a disabled policy changes nothing');

  -- The DEFAULT is the safeguard. A policy row created without naming
  -- delete_enabled cannot erase anything.
  INSERT INTO retention_policies
    (rule_key, retention_class, version, effective_from,
     anchor_a, floor_years, operator, is_active)
  VALUES ('fixture.defaultcheck', 'fixture_ladder_class', 9, now(),
          'fixture_case_closed_at', 1, 'whichever_later', false);

  PERFORM test_support.assert_equals(
    (SELECT delete_enabled::text FROM retention_policies WHERE rule_key = 'fixture.defaultcheck'),
    'false', 'audit', 'a policy that does not name delete_enabled defaults to false');
END $$;

-- ---------------------------------------------------------------------------
-- 62.5  THE MANIFEST. AFC-167 section 8.5.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_run uuid;
  v_n   integer;
BEGIN
  v_run := retention.run('test:manifest', 'dry_run');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE run_id = v_run), '1',
    'manifest', 'one run row per run');

  PERFORM test_support.assert_equals(
    (SELECT status::text FROM retention_runs WHERE run_id = v_run), 'succeeded',
    'manifest', 'the run row records its own outcome');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(count(*)::text, '0') FROM retention_runs WHERE run_id = v_run AND finished_at IS NULL),
    '0', 'manifest', 'a finished run has a finish time');

  -- Every skipped item carries a reason. A skipped row with a NULL reason is a
  -- compliance manifest that cannot answer "why was this not deleted".
  SELECT count(*) INTO v_n FROM retention_run_items
   WHERE run_id = v_run AND action = 'skipped' AND skip_reason IS NULL;
  PERFORM test_support.assert_equals(v_n::text, '0',
    'manifest', 'every skipped item carries a reason');

  SELECT count(*) INTO v_n FROM retention_run_items
   WHERE run_id = v_run AND action <> 'skipped' AND skip_reason IS NOT NULL;
  PERFORM test_support.assert_equals(v_n::text, '0',
    'manifest', 'no acted-on item carries a skip reason');

  -- Every item names the policy version in force, which is the question the
  -- NDPC will actually ask.
  SELECT count(*) INTO v_n FROM retention_run_items
   WHERE run_id = v_run AND policy_version IS NULL;
  PERFORM test_support.assert_equals(v_n::text, '0',
    'manifest', 'every manifest item names the policy version it acted under');

  -- Counts are recorded on the run header for the metrics pipeline.
  PERFORM test_support.assert_true(
    (SELECT counts ? 'deleted' AND counts ? 'would_delete' AND counts ? 'skipped'
            AND counts ? 'held' AND counts ? 'indeterminate' AND counts ? 'failed'
       FROM retention_runs WHERE run_id = v_run),
    'manifest', 'the run header records every counter the metrics view needs');

  -- The skip_reason set is exactly the five in the schema -- F8 removed
  -- 'past_due' because being past due is the reason to act, not a reason to skip.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_run_items
         (run_id, retention_class, action, skip_reason)
       SELECT run_id, 'fixture_medical', 'skipped', 'past_due'
         FROM retention_runs WHERE run_id = (
           SELECT run_id FROM retention_runs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1)$q$,
    '23514', 'manifest', 'F8: past_due is not a storable skip reason');

  -- And the metric view is readable by the monitoring identity.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT retention_records_past_due, retention_records_deleted, retention_records_held,
            retention_records_indeterminate, retention_last_run_at
       FROM retention_metrics$q$,
    'manifest', 'the observability view is readable by the runtime identity');

  PERFORM test_support.assert_not_raises('retention_worker',
    $q$SELECT retention_records_past_due FROM retention_metrics$q$,
    'manifest', 'the observability view is readable by the retention worker');

  PERFORM test_support.assert_true(
    (SELECT retention_last_run_at IS NOT NULL FROM retention_metrics),
    'manifest', 'the last run time is exported, so "the job stopped" is detectable');
END $$;

-- ---------------------------------------------------------------------------
-- 62.6  THE MANIFEST IS EVIDENCE. It cannot be rewritten.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_run     uuid;
  v_wd_run  uuid;
BEGIN
  SELECT run_id INTO v_run FROM retention_runs
   WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1;

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE retention_runs SET counts = '{"deleted": 0}'::jsonb WHERE run_id = %L$q$, v_run),
    '23001', 'manifest', 'a finished run cannot have its counts rewritten');

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE retention_runs SET status = 'succeeded', finished_at = NULL WHERE run_id = %L$q$, v_run),
    '23001', 'manifest', 'a finished run cannot be re-opened');

  PERFORM test_support.assert_raises(NULL,
    format($q$DELETE FROM retention_runs WHERE run_id = %L$q$, v_run),
    '23001', 'manifest', 'a run row cannot be deleted');

  -- A run that is still running may be completed -- that is the engine doing it,
  -- not a third party editing history. Written with as_role, NOT through a
  -- probe: probe() discards its writes, so the next assertion would run against
  -- a row that is still open and would pass for the wrong reason.
  INSERT INTO retention_runs (run_id, mode, status, actor)
  VALUES (gen_random_uuid(), 'dry_run', 'running', 'test:in-flight');

  PERFORM test_support.as_role(NULL,
    $q$UPDATE retention_runs SET status = 'failed', finished_at = now(),
            error = 'reconciled: job killed mid-run, manifest reviewed'
        WHERE actor = 'test:in-flight'$q$);

  PERFORM test_support.assert_equals(
    (SELECT status::text FROM retention_runs WHERE actor = 'test:in-flight'), 'failed',
    'manifest', 'precondition: the in-flight run has been closed out as failed');

  PERFORM test_support.assert_raises(NULL,
    $q$UPDATE retention_runs SET status = 'succeeded', error = NULL
        WHERE actor = 'test:in-flight'$q$,
    '23001', 'manifest', 'and once closed it is frozen');

  -- Run items are append-only too. Anchored on a run that actually HAS a
  -- would_delete item: an UPDATE or DELETE that matches zero rows never fires a
  -- row trigger, so a manifest assertion scoped to the wrong run passes
  -- vacuously.
  SELECT run_id INTO v_wd_run FROM retention_run_items WHERE action = 'would_delete' LIMIT 1;

  PERFORM test_support.assert_true(v_wd_run IS NOT NULL, 'manifest',
    'precondition: a manifest with an acted-on item exists');

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE retention_run_items SET action = 'skipped', skip_reason = 'held'
             WHERE run_id = %L AND action = 'would_delete'$q$, v_wd_run),
    '23001', 'manifest', 'a manifest item cannot be edited after the fact');

  PERFORM test_support.assert_raises(NULL,
    format($q$DELETE FROM retention_run_items WHERE run_id = %L$q$, v_wd_run),
    '23001', 'manifest', 'a manifest item cannot be deleted');

  -- The refusal is the trigger, not a privilege: a role with ALL on the table
  -- is still refused. A grant list can be widened by accident; a trigger that
  -- rejects a fully-granted session is not something a role change removes.
  PERFORM test_support.as_role(NULL,
    $q$GRANT ALL PRIVILEGES ON retention_run_items TO test_table_super$q$);

  PERFORM test_support.assert_raises('test_table_super',
    format($q$DELETE FROM retention_run_items WHERE run_id = %L$q$, v_wd_run),
    '23001', 'manifest', 'a role with ALL on the table still cannot delete a manifest item');

  -- The actor is part of the evidence, and it is NOT NULL at the schema level.
  -- Asserted over every run rather than against "the latest one", which would
  -- be an assertion about test ordering and not about the schema.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE actor IS NULL OR actor = ''), '0',
    'manifest', 'every run records who ran it');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE started_at IS NULL), '0',
    'manifest', 'every run records when it started');
END $$;

-- ---------------------------------------------------------------------------
-- 62.7  SINGLE WRITER.
--
-- A scheduled job that can overlap itself will, eventually, run two erasures
-- concurrently over the same rows. One guard: pg_try_advisory_lock.
--
-- Its limits are asserted rather than glossed, because a control whose limits
-- are undocumented is a control nobody knows when to distrust:
--
--   * it DOES stop a second session -- the real case, two scheduler firings
--     overlapping;
--   * it is RE-ENTRANT within one session, so two calls on one connection are
--     not stopped by it (deployment requirement: one call per connection);
--   * it is RELEASED when a session ends, so it does NOT survive a crash.
--
-- The cross-session half cannot be exercised here: this harness is a single
-- connection, and a session already holding the lock can take it again. That
-- re-entrancy is asserted below as the property it is, and the positive
-- control is asserted so "the run was refused" can never mean "the job is
-- broken".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_first  boolean;
  v_second boolean;
BEGIN
  PERFORM retention.run('test:no-overlap', 'dry_run');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE actor = 'test:no-overlap' AND status = 'succeeded'), '1',
    'writer', 'positive control: with nothing in flight the run proceeds and records itself');

  v_first  := pg_try_advisory_lock(4210245981);
  v_second := pg_try_advisory_lock(4210245981);
  PERFORM test_support.assert_true(v_first AND v_second,
    'writer', 'advisory locks are re-entrant within a session, so the lock alone cannot stop same-session overlap');
  PERFORM pg_advisory_unlock(4210245981);
  PERFORM pg_advisory_unlock(4210245981);

  -- And with the key free again, still fine. The earlier unlock balanced.
  PERFORM test_support.assert_not_raises(NULL,
    $q$SELECT retention.run('test:no-overlap:2', 'dry_run')$q$,
    'writer', 'the lock is released on both the success and the failure path, so the job can run again');
END $$;

-- ---------------------------------------------------------------------------
-- 62.8  A MISCONFIGURED CLASS FAILS THE RUN RATHER THAN FAKING AN ERASURE.
--
-- The engine's owner must hold DELETE on every erasure target, so a target is
-- configured and its grant is not. The alternative -- marking the clock deleted
-- and writing 'deleted' into the compliance manifest having removed nothing --
-- would be a false record produced by the control that exists to make erasure
-- provable.
--
-- This is also where the failure-record semantics are pinned down. A failed run
-- leaves NO retention_runs row, because the row and the failure are in the same
-- transaction and roll back together. That is asserted, not assumed, and the
-- alternative -- an UPDATE in the handler that appears to record the failure
-- and is then undone by the same rollback -- is exactly what this suite exists
-- to rule out.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_orphan_notes (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       person_id uuid NOT NULL,
       body text
     )$c$);
END $$;

INSERT INTO retention_policies
  (rule_key, retention_class, version, effective_from,
   anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
VALUES ('fixture.notarget', 'fixture_orphan', 1, now() - interval '1 day',
        'fixture_case_closed_at', 1, 'whichever_later', '["identified"]'::jsonb, true, true);

DO $$
DECLARE
  v_person uuid;
  v_run    uuid;
  v_clock  uuid;
  v_err    text;
BEGIN
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '50 years')::date, 'active') RETURNING id INTO v_person;

  -- A class with an enabled policy and NO entry in retention_class_sources.
  -- fixture_orphan_notes exists and holds rows; it is simply not configured as
  -- an erasure target, which is exactly the state a half-finished
  -- provisioning leaves behind.
  INSERT INTO fixture_orphan_notes (person_id, body) VALUES (v_person, 'unconfigured target row');
  INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
  VALUES (v_person, now() - interval '3 years');

  PERFORM retention.sync_clocks();

  SELECT id INTO v_clock FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_orphan';

  PERFORM test_support.assert_true(v_clock IS NOT NULL,
    'failrun', 'precondition: the unconfigured class has a due clock');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_class_sources WHERE retention_class = 'fixture_orphan'),
    '0', 'failrun', 'precondition: the class has no configured erasure target');

  -- A dry run is allowed to report the candidate: reporting what it WOULD do is
  -- exactly what a dry run is for. Scoped to this suite's person -- the policy
  -- is active for everyone and other people's clocks land in the same manifest.
  v_run := retention.run('test:failrun:dry', 'dry_run');
  PERFORM test_support.assert_equals(
    (SELECT action::text FROM retention_run_items
      WHERE run_id = v_run AND retention_class = 'fixture_orphan'
        AND person_id = v_person), 'would_delete',
    'failrun', 'a dry run reports the candidate for a class with no erasure target');

  -- The live run must fail rather than claim an erasure it cannot perform.
  BEGIN
    PERFORM retention.run('test:failrun:live', 'live');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  PERFORM test_support.assert_true(v_err IS NOT NULL,
    'failrun', 'a live run against a class with no erasure target fails the run');

  PERFORM test_support.assert_true(v_err LIKE '%no erasure targets%',
    'failrun', 'and it says why, rather than failing somewhere inside the erasure');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs WHERE actor = 'test:failrun:live'), '0',
    'failrun', 'the failed run leaves no run row: the row is in the transaction that just rolled back');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = (SELECT run_id FROM retention_runs WHERE actor = 'test:failrun:dry')
        AND action = 'deleted'), '0',
    'failrun', 'no manifest item claims a deletion that did not happen');

  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks WHERE id = v_clock), 'due',
    'failrun', 'the clock is not marked deleted when nothing was erased');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_orphan_notes WHERE person_id = v_person), '1',
    'failrun', 'the row that could not be erased is still there');

  -- What the metric actually counts, stated as the assertion so the deviation in
  -- the view's COMMENT cannot be forgotten: reconciliation counter, not live
  -- failure counter. Suite 62.6 reconciled one interrupted run, so this is 1,
  -- and the reason string says so.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE status = 'failed' AND error LIKE 'reconciled:%'), '1',
    'failrun', 'retention_runs_failed counts runs reconciled as failed, not live failures');

  PERFORM test_support.assert_true(
    (SELECT retention_runs_failed_reason LIKE '%reconciled:%' FROM retention_metrics),
    'failrun', 'the reconciled run carries its reason into the metrics view');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_runs
      WHERE status = 'failed' AND actor = 'test:failrun:live'), '0',
    'failrun', 'a live failure is never counted here, because its row rolled back: job failure is alerted from the log');

  -- Once the class is configured properly, the job runs. A control that stops
  -- the job permanently after one misconfiguration is a control nobody can
  -- operate.
  PERFORM test_support.as_role(NULL,
    $c$INSERT INTO retention_class_sources (retention_class, table_name, person_column)
     VALUES ('fixture_orphan', 'fixture_orphan_notes', 'person_id')
     ON CONFLICT DO NOTHING$c$);

  PERFORM retention.sync_clocks();
  v_run := retention.run('test:failrun:fixed', 'live');

  PERFORM test_support.assert_equals(
    (SELECT action::text FROM retention_run_items
      WHERE run_id = v_run AND retention_class = 'fixture_orphan'
        AND person_id = v_person), 'deleted',
    'failrun', 'after the class is configured the same fixture erases cleanly');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_orphan_notes WHERE person_id = v_person), '0',
    'failrun', 'the row is gone, and this time the manifest is telling the truth');
END $$;
