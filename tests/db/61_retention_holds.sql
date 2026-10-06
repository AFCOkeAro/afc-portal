-- tests/db/61_retention_holds.sql
--
-- AFC-167 section 8.2. LEGAL HOLD. D4: a hold outranks every retention rule
-- without exception.
--
-- This is the control that has to be right when the engine is wrong. Every
-- other failure mode in this system deletes too little; this one deletes
-- something under legal obligation not to, and nothing afterwards can put it
-- back. So the assertions here are deliberately paranoid about the ORDER of
-- checks, not just about whether a hold exists.
--
-- Three separate claims, each asserted separately because they fail
-- differently:
--   61.1  a hold beats an already-due clock
--   61.2  a hold beats delete_enabled = true  (the fixed order, not "both true")
--   61.3  a hold placed between selection and erasure still stops the erasure
--         -- the reason retention.run re-reads the hold instead of trusting
--            the selection
--   61.4  CTO review F2: a hold whose scope does not resolve is refused at
--         WRITE time. A stored-but-unresolvable hold reads as active, blocks
--         nothing, and produces exactly the false assurance this control
--         exists to prevent.
--   61.5  a released hold is history: the row survives, cannot be deleted,
--         cannot be re-armed, and a release the database cannot attribute is
--         refused rather than stored

-- Reuse the fixture people from 60_retention_due_date.sql. Suites run in
-- filename order in one transaction, so the fixtures are already present.
DO $$
DECLARE
  v_hold_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fixture_persons WHERE label = 'held_person') THEN
    INSERT INTO people (date_of_birth, status)
    VALUES ((now() - interval '60 years')::date, 'active') RETURNING id INTO v_hold_id;
    INSERT INTO fixture_persons VALUES ('held_person', v_hold_id);
  END IF;
END $$;

-- A second class on the same held person, so 61.1 can show the hold is scoped
-- per CLASS rather than freezing the whole person. D3 says the classes are
-- independent, and a hold that silently freezes everything would be a
-- different and much larger control than the policy describes.
INSERT INTO fixture_medical_notes (person_id, body)
SELECT person_id, 'held fixture note' FROM fixture_persons WHERE label = 'held_person';

-- A due medical class whose policy has delete_enabled = true, so the hold is
-- the only thing standing between the fixture and deletion.
INSERT INTO retention_policies
  (rule_key, retention_class, version, effective_from,
   anchor_a, floor_years, operator, ladder_stages, delete_enabled, is_active)
VALUES ('fixture.medical', 'fixture_medical', 1, now() - interval '1 day',
        'fixture_case_closed_at', 1, 'whichever_later', '["identified"]'::jsonb, true, true)
ON CONFLICT (rule_key, version) DO NOTHING;

-- The held person needs a closed concern, otherwise the medical clock is
-- indeterminate (no anchor value) and "the hold stopped the deletion" would be
-- indistinguishable from "nothing was ever deletable". This is the
-- precondition assertion in 61.1 doing the work at fixture level.
INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
SELECT person_id, now() - interval '3 years'
  FROM fixture_persons WHERE label = 'held_person';

-- ---------------------------------------------------------------------------
-- 61.4  FIRST, because the rest of the suite needs a hold that can be stored.
-- F2: the scope must resolve, or the hold is refused.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person  uuid;
  v_unknown uuid := '00000000-0000-0000-0000-00000000dead';
BEGIN
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'held_person';

  -- A mistyped person id is the exact failure F2 describes: stored, displayed
  -- active, blocking nothing.
  PERFORM test_support.assert_raises(NULL,
    format($q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
             VALUES ('person', %L::text, 'typo in the id', gen_random_uuid())$q$, v_unknown),
    '23001', 'hold', 'F2: a person-scoped hold naming an unknown person is refused');

  -- An archived person is not a live person. A hold on them would not be
  -- enforced by the engine either, because the engine resolves holds the same
  -- way.
  PERFORM test_support.as_role(NULL,
    $q$UPDATE people SET status = 'archived'
        WHERE id = (SELECT person_id FROM fixture_persons WHERE label = 'age_case')$q$);
  PERFORM test_support.assert_raises(NULL,
    format($q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
             VALUES ('person', %L::text, 'archived person', gen_random_uuid())$q$,
            (SELECT person_id FROM fixture_persons WHERE label = 'age_case')),
    '23001', 'hold', 'F2: a person-scoped hold on an archived person is refused');

  -- A retention class no policy names resolves against nothing.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('retention_class', 'no_such_class', 'typo', gen_random_uuid())$q$,
    '23001', 'hold', 'F2: a class-scoped hold naming an unknown class is refused');

  -- A collection hold resolves against the erasure target map, not against
  -- pg_class. A table name that is not an erasure target blocks nothing.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('collection', 'pg_class', 'not an erasure target', gen_random_uuid())$q$,
    '23001', 'hold', 'F2: a collection hold on a system catalog is refused');

  -- And one that IS an erasure target is accepted, so the refusals above are
  -- refusals of an unresolvable scope and not of collection holds generally.
  -- Scoped to the safeguarding class's table so it does not also freeze the
  -- medical erasure this suite depends on later. Inserted with as_role rather
  -- than through a probe, because a probe discards its writes and the delete
  -- assertion below needs a row to exist.
  PERFORM test_support.as_role(NULL,
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('collection', 'fixture_safeguarding_concerns',
               'positive control: whole collection held', gen_random_uuid())$q$);

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE scope_type = 'collection'), '1',
    'hold', 'positive control: a hold on a configured erasure target is stored');

  PERFORM test_support.assert_raises(NULL,
    $q$DELETE FROM legal_holds WHERE scope_type = 'collection'$q$,
    '23001', 'hold', 'a hold row cannot be deleted, active or not');
END $$;

-- ---------------------------------------------------------------------------
-- 61.1 + 61.2  THE ORDER OF CHECKS.
--
-- One person, one class, a due clock, delete_enabled = true, and a hold. If
-- the hold is checked anywhere other than first, this run deletes the row and
-- the assertion below fails with a count of one instead of zero.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person  uuid;
  v_clock   record;
  v_run     uuid;
  v_note_ct integer;
BEGIN
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'held_person';

  -- The medical note is the erasure target for this class.
  SELECT count(*) INTO v_note_ct FROM fixture_medical_notes WHERE person_id = v_person;

  INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
  VALUES ('person', v_person::text, 'litigation, fixture', gen_random_uuid());

  PERFORM retention.sync_clocks();

  SELECT * INTO v_clock FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_medical';

  -- Sanity: the clock really is due, and its policy really is enabled. Without
  -- this, "the hold prevented deletion" could mean "nothing was deletable".
  PERFORM test_support.assert_true(v_clock.due_at IS NOT NULL AND v_clock.due_at <= now(),
    'hold', 'precondition: the held clock is genuinely past due');

  PERFORM test_support.assert_equals(
    (SELECT delete_enabled::text FROM retention_policies
      WHERE id = v_clock.policy_id), 'true',
    'hold', 'precondition: the held clock policy has delete_enabled = true');

  -- Dry run first, because it is the mode that ships.
  v_run := retention.run('test:hold', 'dry_run');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(skip_reason, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_medical'),
    'held', 'hold', 'a dry run reports the due clock as held, not as would_delete');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND action IN ('would_delete', 'deleted')),
    '0', 'hold', 'a held clock is not a would_delete candidate in a dry run');

  -- And live, which is the one that actually matters.
  v_run := retention.run('test:hold', 'live');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_medical_notes WHERE person_id = v_person),
    v_note_ct::text,
    'hold', 'a LIVE run did not erase a held record');

  PERFORM test_support.assert_equals(
    (SELECT state::text FROM retention_clocks
      WHERE person_id = v_person AND retention_class = 'fixture_medical'),
    'held', 'hold', 'the held clock is marked held, not deleted');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(skip_reason, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_medical'),
    'held', 'hold', 'the live manifest records the hold as the reason');

  -- The hold is class-scoped in its effect only where the policy says so. A
  -- PERSON-scoped hold does freeze every class for that person, and that is the
  -- correct reading: the hold is on the person, not on the category.
  PERFORM test_support.assert_true(retention.has_active_hold(v_person, 'fixture_medical'),
    'hold', 'a person-scoped hold covers every class for that person');

  -- A class-scoped hold covers that class for EVERY person. Asserted because
  -- the reverse mistake -- a class hold quietly behaving like a person hold --
  -- is the kind of thing that looks correct in a demo.
  PERFORM test_support.assert_true(
    retention.has_active_hold((SELECT person_id FROM fixture_persons WHERE label = 'floor_case'),
                              'fixture_medical') = false,
    'hold', 'a person-scoped hold does not leak to a different person');
END $$;

-- ---------------------------------------------------------------------------
-- 61.3  A REPEAT RUN UNDER THE SAME HOLD.
--
-- The job fires on a schedule, so the claim that matters is not "the first run
-- respected the hold" but "every run does, including the one that finds the
-- clock already marked held". A hold that stopped the first run and not the
-- seventh is not a control.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person   uuid;
  v_run      uuid;
  v_before   integer;
  v_after    integer;
BEGIN
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'held_person';
  SELECT count(*) INTO v_before FROM fixture_medical_notes WHERE person_id = v_person;

  v_run := retention.run('test:hold:repeat', 'live');

  SELECT count(*) INTO v_after FROM fixture_medical_notes WHERE person_id = v_person;

  PERFORM test_support.assert_equals(v_after::text, v_before::text,
    'hold', 'a second live run under the same hold erases nothing further');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(skip_reason, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_medical'),
    'held', 'hold', 'a repeated run still reports held rather than already_deleted');

  PERFORM test_support.assert_equals(
    (SELECT status::text FROM retention_runs WHERE run_id = v_run), 'succeeded',
    'hold', 'the run under a hold succeeds; a hold is a skip, not a failure');
END $$;

-- ---------------------------------------------------------------------------
-- 61.5  A RELEASE IS ATTRIBUTED, AND IT IS THE DATABASE THAT ATTRIBUTES IT.
--
-- AFC-249 F3. Before this, release_hold(p_hold_id, p_released_by) stored the
-- uuid the CALLER supplied, while its own COMMENT claimed the database stamped
-- it. Only released_at was the database's. The parameter is gone; the releaser
-- comes from retention_principals, keyed on session_user.
--
-- So the order of these assertions is the point, and it is why they cannot be
-- collapsed into "the release is stamped":
--
--   1. the harness session role is NOT provisioned, and a release is REFUSED
--      -- not stored with a NULL or a fabricated releaser. A release nobody can
--      attribute is a release that cannot be defended, and it unblocks the
--      deletion of records somebody placed a hold on;
--   2. only then is the role provisioned, by the owner role, which is the shape
--      a real deployment uses;
--   3. and the stored releaser is the PROVISIONED principal -- asserted against
--      a fabricated uuid the caller had in hand, so a function that went back to
--      honouring an argument would go red here rather than quietly agree.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hold    uuid;
  v_holder  text;
  v_forged  uuid := '00000000-0000-0000-0000-00000000c0de';
  v_real    uuid := '00000000-0000-0000-0000-00000000a11e';
  v_released timestamptz;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  SELECT id INTO v_hold FROM legal_holds
   WHERE scope_type = 'person' AND released_at IS NULL LIMIT 1;

  PERFORM test_support.assert_true(v_hold IS NOT NULL, 'hold',
    'precondition: an active hold exists to release');

  PERFORM test_support.assert_true(v_holder IS NOT NULL AND v_holder <> '', 'hold',
    'precondition: the harness session role is named, so a release can be attributed to a role at all');

  -- Precondition on the abuse itself: the role this suite releases under is not
  -- provisioned. Without this, the refusal below could be passing because some
  -- earlier suite happened to add the row.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_principals WHERE role_name = v_holder), '0',
    'hold', 'precondition: the harness session role has no provisioned principal');

  -- A NULL hold is an argument error, not an attribution decision, and it is
  -- refused before the attribution is even consulted.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT retention.release_hold(NULL)$q$,
    '22023', 'hold', 'releasing a hold without naming which hold is refused');

  -- THE ATTEMPT. No principal for this session: refused, and the hold is still
  -- holding. Asserted as "still active" rather than as "an error was raised",
  -- because an error that arrived after the UPDATE would leave the same log line.
  PERFORM test_support.assert_raises(NULL,
    format($q$SELECT retention.release_hold(%L::uuid)$q$, v_hold),
    '23001', 'hold', 'a release under a role with no provisioned principal is refused rather than stored unattributed');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE id = v_hold AND released_at IS NULL), '1',
    'hold', 'and the hold it refused to release is still holding');

  -- Provision it, the way a deployment does: under the owner role, which is the
  -- only role the table's trigger admits. v_real is deliberately NOT the forged
  -- uuid the caller was holding.
  PERFORM test_support.as_role('directus_migrator',
    format($c$INSERT INTO retention_principals (role_name, principal_id, note)
           VALUES (%L, %L::uuid, 'test harness session identity')$c$,
            v_holder, v_real));

  PERFORM test_support.as_role(NULL,
    format($q$SELECT retention.release_hold(%L::uuid)$q$, v_hold));

  SELECT released_at INTO v_released FROM legal_holds WHERE id = v_hold;

  PERFORM test_support.assert_true(v_released IS NOT NULL, 'hold',
    'the release is recorded with a timestamp');

  -- THE MEASUREMENT. The stored releaser is the provisioned principal, and is
  -- not the uuid the caller had in hand.
  PERFORM test_support.assert_equals(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold), v_real::text,
    'hold', 'the releaser recorded is the principal provisioned for the session, not a value the caller supplied');

  PERFORM test_support.assert_true(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold) <> v_forged::text,
    'hold', 'and specifically not the fabricated uuid the caller was holding');

  -- The row survives. A release is a historical fact about a legal decision.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE id = v_hold), '1',
    'hold', 'a released hold row is still there: the release is history, not a deletion');

  -- It cannot be deleted to hide the fact it existed.
  PERFORM test_support.assert_raises(NULL,
    format($q$DELETE FROM legal_holds WHERE id = %L::uuid$q$, v_hold),
    '23001', 'hold', 'a released hold cannot be deleted');

  -- It cannot be re-armed, and its release cannot be back-dated or moved.
  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE legal_holds SET released_at = NULL WHERE id = %L::uuid$q$, v_hold),
    '23001', 'hold', 'a released hold cannot be re-armed by clearing released_at');

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE legal_holds SET released_by = gen_random_uuid(), released_at = now()
            WHERE id = %L::uuid$q$, v_hold),
    '23001', 'hold', 'a release cannot be re-stamped with a different actor and time');

  -- And the placed fields cannot be rewritten to change what was held.
  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE legal_holds SET scope_id = 'somebody-else' WHERE id = %L::uuid$q$, v_hold),
    '23001', 'hold', 'the scope of a hold cannot be rewritten after the fact');

  PERFORM test_support.assert_raises(NULL,
    format($q$UPDATE legal_holds SET reason = 'nothing to see here' WHERE id = %L::uuid$q$, v_hold),
    '23001', 'hold', 'the reason a hold was placed cannot be rewritten after the fact');

  -- A released hold no longer holds: the clock is due again and the erasure
  -- proceeds. This is the control for 61.1 -- without it, "the hold stopped the
  -- run" could mean "the person-scoped hold stopped every run forever".
  PERFORM test_support.assert_true(
    NOT retention.has_active_hold(
      (SELECT person_id FROM fixture_persons WHERE label = 'held_person'),
      'fixture_medical'),
    'hold', 'a released hold no longer holds');

  -- A second release is refused rather than silently re-stamping.
  PERFORM test_support.assert_raises(NULL,
    format($q$SELECT retention.release_hold(%L::uuid)$q$, v_hold),
    '22023', 'hold', 'releasing an already-released hold is refused');

  -- A hold that does not exist is refused, not a silent no-op. Asserted with a
  -- role that IS provisioned, so the refusal is about the hold and not about the
  -- attribution -- otherwise it would pass for the wrong reason.
  PERFORM test_support.assert_raises(NULL,
    format($q$SELECT retention.release_hold('00000000-0000-0000-0000-00000000beef'::uuid)$q$),
    '22023', 'hold', 'releasing a hold that does not exist is refused, not a silent no-op');
END $$;

-- ---------------------------------------------------------------------------
-- 61.6  POSITIVE CONTROL. With the hold released, the erasure happens.
--
-- A suite in which nothing is ever deleted cannot tell "the hold worked" from
-- "nothing was deletable". This deletes for real, on a throwaway fixture, and
-- proves the hold was the only thing standing in the way.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid;
  v_run    uuid;
  v_clock  record;
BEGIN
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'held_person';

  SELECT * INTO v_clock FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_medical';

  v_run := retention.run('test:hold:released', 'live');

  PERFORM test_support.assert_equals(
    (SELECT coalesce(string_agg(skip_reason, ','), 'none')
       FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_medical'),
    'none', 'hold', 'with the hold released the clock is no longer skipped');

  PERFORM test_support.assert_equals(
    (SELECT action::text FROM retention_run_items
      WHERE run_id = v_run AND person_id = v_person
        AND retention_class = 'fixture_medical'),
    'deleted', 'hold', 'the live run deleted the record once the hold was released');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM fixture_medical_notes WHERE person_id = v_person), '0',
    'hold', 'the erasure target rows are gone');

  -- D3: the person row is NOT deleted. A category erasure that took the person
  -- with it would be the "delete the person" job the design forbids.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM people WHERE id = v_person), '1',
    'hold', 'D3: erasing a category did not erase the person');
END $$;
