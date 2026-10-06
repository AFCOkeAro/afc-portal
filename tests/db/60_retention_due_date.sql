-- tests/db/60_retention_due_date.sql
--
-- AFC-167 section 7. THE TEST THAT PROVES THE D1 PROMISE.
--
-- ADR-159-2 section 4 defines the acceptance test as: change a retention
-- constant in a fixture, and the computed due date for a given record changes
-- with NO code change. The CTO amendment on this issue says the ADR's version
-- of that test can be passed by a fake implementation -- a test that mutates a
-- fixture and observes a moved date proves nothing if the implementation
-- ignored the table and hard-coded the number.
--
-- So this suite does both halves:
--   60.1  behaviour  -- change the row, the date moves, no code changed
--   60.2  mechanics  -- compute_due_date is a pure function of its arguments,
--                        so a hard-coded engine cannot pass
--   60.3  fail-closed -- a null anchor is NEVER a due date and NEVER deletable
--   60.4  operator   -- whichever_later / whichever_earlier mean what they say
--   60.5  constraints-- the config shapes a careless edit produces are refused
--
-- The values below are FIXTURES, not decisions. AFC-167 section 10 forbids
-- choosing the retention values; they are board-ratified and counsel is
-- confirming them. A fixture asserts that the arithmetic honours its input, and
-- the production migration seeds no policy at all.
--
-- Every fixture date is RELATIVE to now(). An absolute date in this file is a
-- test that passes until the calendar moves past it, and a retention control
-- whose test expires is not a control.

-- ---------------------------------------------------------------------------
-- Fixture. Three people, chosen so that each exercises a different branch.
--
--   floor_case : old enough that the age anchor is long past, and the case
--                closed recently enough that the floor is the binding anchor.
--                Changing floor_years MUST move the date here.
--   age_case   : case closed long ago, person young. The age anchor binds.
--                Changing floor_years must NOT move the date -- that is the
--                control for 60.1, without it a test that "the date moved"
--                proves only that something moved.
--   open_case  : no closed case at all. Indeterminate.
-- ---------------------------------------------------------------------------
-- Fixture tables are created as directus_migrator, the engine's owner role,
-- NOT as the test session role. That is not tidiness: retention.run is
-- SECURITY DEFINER and erases with its owner's rights, so its owner must hold
-- DELETE on every erasure target. In production that means the domain tables
-- are owned by the migration role, which is how this repository already
-- bootstraps `incidents`. A fixture built as superuser would hide the missing
-- grant instead of exposing it, and the first real deployment would fail on it.
DO $$
BEGIN
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_safeguarding_concerns (
       id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       person_id      uuid NOT NULL,
       case_closed_at timestamptz
     )$c$);
  PERFORM test_support.as_role('directus_migrator',
    $c$CREATE TABLE IF NOT EXISTS fixture_medical_notes (
       id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       person_id uuid NOT NULL,
       body      text
     )$c$);
END $$;

CREATE TABLE IF NOT EXISTS fixture_persons (
  label     text PRIMARY KEY,
  person_id uuid NOT NULL
);

DO $$
DECLARE
  v_floor uuid; v_age uuid; v_open uuid;
BEGIN
  -- One statement per person so each id is known by name rather than by
  -- position. A multi-row INSERT ... RETURNING INTO is not a way to get three
  -- ids out, and a fixture that depends on row order is not a fixture.
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '60 years')::date, 'active') RETURNING id INTO v_floor;
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '5 years')::date, 'active') RETURNING id INTO v_age;
  INSERT INTO people (date_of_birth, status)
  VALUES ((now() - interval '5 years')::date, 'active') RETURNING id INTO v_open;

  INSERT INTO fixture_persons VALUES
    ('floor_case', v_floor), ('age_case', v_age), ('open_case', v_open);
END $$;

INSERT INTO retention_anchor_sources (anchor_key, table_name, column_name, is_person_attribute)
VALUES ('fixture_case_closed_at', 'fixture_safeguarding_concerns', 'case_closed_at', false),
       ('fixture_date_of_birth',  'people', 'date_of_birth',          true);

INSERT INTO retention_class_sources (retention_class, table_name, person_column)
VALUES ('fixture_safeguarding', 'fixture_safeguarding_concerns', 'person_id'),
       ('fixture_medical',       'fixture_medical_notes',         'person_id');

-- The floor case closed recently: floor_years is the binding operand, so a
-- change to floor_years has to move the date.
INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
SELECT person_id, now() - interval '2 years'
  FROM fixture_persons WHERE label = 'floor_case';

-- The age case closed long ago: the age anchor is the binding operand.
INSERT INTO fixture_safeguarding_concerns (person_id, case_closed_at)
SELECT person_id, now() - interval '40 years'
  FROM fixture_persons WHERE label = 'age_case';

-- ---------------------------------------------------------------------------
-- 60.1  BEHAVIOUR. Change the row. The date moves. No code changed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person   uuid;
  v_age_only uuid;
  v_due_a    timestamptz;
  v_due_b    timestamptz;
  v_age_a    timestamptz;
  v_age_b    timestamptz;
BEGIN
  SELECT person_id INTO v_person   FROM fixture_persons WHERE label = 'floor_case';
  SELECT person_id INTO v_age_only FROM fixture_persons WHERE label = 'age_case';

  PERFORM test_support.as_role(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from,
          anchor_a, anchor_b, floor_years, age_threshold_years, operator,
          ladder_stages, delete_enabled, is_active, created_by)
       VALUES ('fixture.rule', 'fixture_safeguarding', 1, now() - interval '1 day',
               'fixture_case_closed_at', 'fixture_date_of_birth', 7, 21,
               'whichever_later', '["identified","reviewed"]'::jsonb,
               false, true, NULL)$q$);

  PERFORM retention.sync_clocks();

  SELECT due_at INTO v_due_a FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_safeguarding';
  SELECT due_at INTO v_age_a FROM retention_clocks
   WHERE person_id = v_age_only AND retention_class = 'fixture_safeguarding';

  -- Positive control. If this clock were already indeterminate, the assertion
  -- below would pass for the wrong reason.
  PERFORM test_support.assert_equals(v_due_a::date::text,
    (date_trunc('day', now() - interval '2 years') + interval '7 years')::date::text,
    'd1', 'the floor case is dated from the case closing date plus the configured floor');

  -- Change the schedule. THIS IS THE ENTIRE COUNSEL ANSWER: supersede the
  -- rule, do not rewrite it.
  --
  -- Order matters and the order is safe: retire the old row, then insert the
  -- new active one. The index on (rule_key) WHERE is_active is not deferrable
  -- -- PostgreSQL has no deferrable partial unique indexes -- so insert-first
  -- is not available. The gap the two statements leave, in which the rule has
  -- no active row, is FAIL CLOSED: no active policy means no candidate is
  -- selected and an existing clock keeps its stored due_at until the next
  -- sync. Nobody is erased during the gap.
  PERFORM test_support.as_role(NULL,
    $q$UPDATE retention_policies SET is_active = false
        WHERE rule_key = 'fixture.rule' AND version = 1$q$);

  PERFORM test_support.as_role(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from,
          anchor_a, anchor_b, floor_years, age_threshold_years, operator,
          ladder_stages, delete_enabled, is_active, supersedes_id)
       SELECT rule_key, retention_class, version + 1, now(),
              anchor_a, anchor_b, 5, age_threshold_years, operator,
              ladder_stages, delete_enabled, true, id
         FROM retention_policies
        WHERE rule_key = 'fixture.rule' AND version = 1$q$);

  PERFORM retention.sync_clocks();

  SELECT due_at INTO v_due_b FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_safeguarding';
  SELECT due_at INTO v_age_b FROM retention_clocks
   WHERE person_id = v_age_only AND retention_class = 'fixture_safeguarding';

  PERFORM test_support.assert_true(v_due_a IS NOT NULL AND v_due_b IS NOT NULL,
    'd1', 'a due date is computed at all',
    'a null due date here would make the rest of this suite vacuous');

  PERFORM test_support.assert_equals(v_due_b::date::text,
    (v_due_a::date - interval '2 years')::date::text,
    'd1', 'changing floor_years in the config moved the due date by exactly two years, with no code change');

  PERFORM test_support.assert_true(v_due_b < v_due_a,
    'd1', 'the due date moved EARLIER when the period was shortened');

  -- The control that gives the assertion above its meaning: the age case is
  -- bound by the age anchor, so the same config change must NOT move it. If
  -- both moved, the engine would be ignoring whichever_earlier/later and the
  -- first assertion would be satisfied by an implementation that simply adds
  -- every operand together.
  PERFORM test_support.assert_equals(v_age_b::text, v_age_a::text,
    'd1', 'the same config change did NOT move a clock bound by the other anchor');

  -- Same recompute through the same code path a second time: stable.
  PERFORM retention.sync_clocks();
  PERFORM test_support.assert_equals(
    (SELECT due_at::text FROM retention_clocks
      WHERE person_id = v_person AND retention_class = 'fixture_safeguarding'),
    v_due_b::text,
    'd1', 'a recompute with no config change is idempotent: the due date does not drift');
END $$;

-- ---------------------------------------------------------------------------
-- 60.2  MECHANICS. The function is a pure function of its arguments.
--
-- This is what a fake implementation cannot pass. A hard-coded engine returns
-- the same date for every input, so feeding the arithmetic a different pair of
-- numbers must move the answer. Asserted through the same public entry point
-- the job uses, not by reading the source.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- The base is an EVENT (a case closing) and the birth is a PERSON attribute.
  -- The birth is a decade after the event, so the age anchor is the later one.
  -- That is what makes the assertions below able to distinguish later from
  -- earlier; with a birth before the event the floor is always later and every
  -- assertion passes for the wrong reason.
  v_base  timestamptz := timestamptz '2000-06-01 00:00:00+00';
  v_birth date      := date '2010-01-01';
  v_due   timestamptz;
BEGIN
  SELECT retention.compute_due_date(v_base, v_birth::timestamptz, 7, 21, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(v_due::date::text, (v_birth + interval '21 years')::date::text,
    'd1', 'compute_due_date takes the later of the two anchors');

  SELECT retention.compute_due_date(v_base, v_birth::timestamptz, 40, 21, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(v_due::date::text, (v_base + interval '40 years')::date::text,
    'd1', 'compute_due_date takes the later anchor again when the floor moves past the age');

  SELECT retention.compute_due_date(v_base, v_birth::timestamptz, 7, 40, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(v_due::date::text, (v_birth + interval '40 years')::date::text,
    'd1', 'compute_due_date takes the age anchor when the age threshold moves past the floor');

  -- The fail-closed arithmetic, at the function level. A configured operand
  -- whose anchor value is NULL produces no date, and in particular not now()
  -- and not a zero-year offset from now().
  SELECT retention.compute_due_date(NULL, NULL, 7, NULL, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(coalesce(v_due::text, 'NULL'), 'NULL',
    'd1', 'a floor duration with no anchor value produces no date, never now()');

  SELECT retention.compute_due_date(v_base, NULL, 7, 21, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(v_due::date::text, (v_base + interval '7 years')::date::text,
    'd1', 'whichever_later falls back to the one operand that does have a value');

  SELECT retention.compute_due_date(NULL, NULL, 7, 21, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(coalesce(v_due::text, 'NULL'), 'NULL',
    'd1', 'no anchor value at all produces no date, never a zero');

  SELECT retention.compute_due_date(v_base, v_birth::timestamptz, 7, NULL, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_equals(v_due::date::text, (v_base + interval '7 years')::date::text,
    'd1', 'a null age threshold omits that operand rather than coercing it to zero');

  -- An unrecognised operator produces nothing rather than a guess.
  SELECT retention.compute_due_date(v_base, v_birth::timestamptz, 7, 21, 'whenever')
    INTO v_due;
  PERFORM test_support.assert_equals(coalesce(v_due::text, 'NULL'), 'NULL',
    'd1', 'an unknown operator yields no date instead of a default');

  -- Leap-year anchor. A birthday on the 29th lands on the 28th in a common
  -- year; what matters is that it is a date at all and not an error.
  SELECT retention.compute_due_date(timestamptz '2020-02-29 00:00:00+00', NULL, 1, NULL, 'whichever_later')
    INTO v_due;
  PERFORM test_support.assert_true(v_due IS NOT NULL,
    'd1', 'a leap-day anchor produces a due date rather than an error');
END $$;

-- ---------------------------------------------------------------------------
-- 60.3  FAIL CLOSED. The single most dangerous bug available in this system.
--
-- AFC-167 section 3: a null anchor event has not happened yet. The correct
-- result is state='indeterminate' -- NOT 'due', and NOT a delete candidate.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid;
  v_clock  record;
  v_run    uuid;
BEGIN
  SELECT person_id INTO v_person FROM fixture_persons WHERE label = 'open_case';

  PERFORM retention.sync_clocks();

  SELECT * INTO v_clock FROM retention_clocks
   WHERE person_id = v_person AND retention_class = 'fixture_safeguarding';

  PERFORM test_support.assert_equals(v_clock.state::text, 'indeterminate',
    'failclosed', 'a missing anchor yields state=indeterminate');

  PERFORM test_support.assert_equals(coalesce(v_clock.due_at::text, 'NULL'), 'NULL',
    'failclosed', 'a missing anchor yields a NULL due date, not a zero and not now()');

  PERFORM test_support.assert_true(retention.anchor_missing(NULL, NULL, 7, 21),
    'failclosed', 'anchor_missing is true when a configured operand has no value');

  PERFORM test_support.assert_true(retention.anchor_missing(now(), NULL, NULL, 21),
    'failclosed', 'anchor_missing is true when only the age anchor is missing');

  PERFORM test_support.assert_true(NOT retention.anchor_missing(now(), now(), NULL, 21),
    'failclosed', 'anchor_missing is false when every configured operand has a value');

  PERFORM test_support.assert_true(retention.anchor_missing(NULL, NULL, 7, 21),
    'failclosed', 'anchor_missing is true when both configured operands have no value');

  PERFORM test_support.assert_true(NOT retention.anchor_missing(NULL, NULL, NULL, NULL),
    'failclosed', 'a policy with no operands is a config error, not a missing anchor');

  -- The decisive assertion: run the job over the whole fixture set and confirm
  -- the indeterminate clock does not appear in the manifest as a candidate.
  v_run := retention.run('test:failclosed', 'dry_run');

  PERFORM test_support.assert_equals(v_run::text,
    (SELECT run_id::text FROM retention_runs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1),
    'failclosed', 'the dry run completed and recorded itself');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items rri
      WHERE rri.run_id = v_run
        AND rri.person_id = v_person
        AND rri.action IN ('would_delete', 'deleted')),
    '0', 'failclosed', 'an indeterminate clock is never selected as a deletion candidate');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM retention_run_items rri WHERE rri.run_id = v_run),
    (SELECT count(*)::text FROM retention_clocks
      WHERE due_at IS NOT NULL AND due_at <= now()),
    'failclosed', 'the manifest item count equals the number of reached due dates: nothing extra was examined');

  PERFORM test_support.assert_true(
    (SELECT retention_records_indeterminate > 0 FROM retention_metrics),
    'failclosed', 'the indeterminate record is counted for alerting, not reported as zero');
END $$;

-- ---------------------------------------------------------------------------
-- 60.4  OPERATOR SEMANTICS. whichever_earlier is a real shape, not a synonym.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Same shape as 60.2: the person attribute is a decade after the event, so
  -- the age anchor is the later one and later/earlier are distinguishable.
  v_base  timestamptz := timestamptz '2000-06-01 00:00:00+00';
  v_birth date      := date '2010-01-01';
BEGIN
  PERFORM test_support.assert_equals(
    (retention.compute_due_date(v_base, v_birth::timestamptz, 7, 21, 'whichever_later'))::date::text,
    (v_birth + interval '21 years')::date::text,
    'operator', 'whichever_later of the two anchors is the later one');

  PERFORM test_support.assert_equals(
    (retention.compute_due_date(v_base, v_birth::timestamptz, 7, 21, 'whichever_earlier'))::date::text,
    (v_base + interval '7 years')::date::text,
    'operator', 'whichever_earlier of the same two anchors is the floor');

  PERFORM test_support.assert_equals(
    (retention.compute_due_date(v_base, NULL, 7, NULL, 'whichever_earlier'))::date::text,
    (v_base + interval '7 years')::date::text,
    'operator', 'whichever_earlier with one operand is that operand');
END $$;

-- ---------------------------------------------------------------------------
-- 60.5  CONSTRAINTS. The shapes a config edit can produce but must not store.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- F1: a second ACTIVE row for one rule_key destroys "which rule was in force
  -- when we deleted this". Superseding means deactivating, never duplicating.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from, anchor_a,
          floor_years, operator, is_active)
       SELECT rule_key, 'fixture_second', version + 10, now(), anchor_a,
              floor_years, operator, true
         FROM retention_policies WHERE rule_key = 'fixture.rule' AND version = 2$q$,
    '23505', 'd1config', 'F1: two active rows for one rule_key is refused');

  -- Version is what makes supersession possible, so it is not optional.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from, anchor_a,
          floor_years, operator)
       VALUES ('fixture.noversion', 'fixture_second', NULL, now(),
               'fixture_case_closed_at', 7, 'whichever_later')$q$,
    '23502', 'd1config', 'a policy with no version is refused');

  -- F3: an unconfigured policy computes no due date and fails closed forever.
  -- Storing one is how a rule silently stops firing.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from, anchor_a, operator)
       VALUES ('fixture.nooperand', 'fixture_second', 1, now(),
               'fixture_case_closed_at', 'whichever_later')$q$,
    '23514', 'd1config', 'F3: a policy with no duration at all is refused');

  -- An anchor with no age threshold reads as "and until the child turns N"
  -- with no N.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from,
          anchor_a, anchor_b, floor_years, operator)
       VALUES ('fixture.noage', 'fixture_second', 1, now(),
               'fixture_case_closed_at', 'fixture_date_of_birth', 7, 'whichever_later')$q$,
    '23514', 'd1config', 'an age anchor with no age threshold is refused');

  -- A policy naming an anchor that is not in the anchor map is a config error
  -- the engine must hit at write time, not at run time.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO retention_policies
         (rule_key, retention_class, version, effective_from,
          anchor_a, floor_years, operator)
       VALUES ('fixture.badanchor', 'fixture_second', 1, now(),
               'anchor_that_does_not_exist', 7, 'whichever_later')$q$,
    '23503', 'd1config', 'a policy naming an unconfigured anchor is refused');
END $$;
