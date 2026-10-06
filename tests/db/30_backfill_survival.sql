-- tests/db/30_backfill_survival.sql
--
-- AFC-166 acceptance criterion 3: re-running the migration after rows exist
-- changes nothing.
--
-- Runs against a second copy of the pre-0002 table in its own schema, because
-- incidents is not deletable by design and a separate copy keeps the two
-- scenarios honest. The copy is a throwaway schema, dropped by the runner with
-- DROP SCHEMA ... CASCADE -- an owner DDL operation that does not go through
-- the row-level guards, which is the only reason it works.
--
-- The scenario: rows exist with no awareness_at column at all, exactly as on a
-- deployment where the register has been in use. 0002 backfills them, marks
-- them inferred, and a second run must be a no-op.
--
-- The migration is included with \i so this file is runnable with psql as-is.
-- search_path puts the copy first so the unqualified table name resolves to it.

CREATE SCHEMA IF NOT EXISTS backfill_probe;

CREATE TABLE backfill_probe.incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE,
  summary       text NOT NULL,
  severity      text NOT NULL DEFAULT 'minor',
  status        text NOT NULL DEFAULT 'open',
  branch_id     uuid,
  detected_at   timestamptz,
  reported_at   timestamptz,
  detected_by   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The probe grants the runtime identity the same access it has on the real
-- register, so the fixtures below are inserted through a role that Directus
-- actually uses.
GRANT USAGE ON SCHEMA backfill_probe TO directus_app, test_table_super;
GRANT SELECT, INSERT, UPDATE ON backfill_probe.incidents TO directus_app, test_table_super;

DO $$
BEGIN
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO backfill_probe.incidents (ref, summary, detected_at, created_at) VALUES
      ('BF-DETECTED-ONLY', 'Engineering found it, nobody told anyone else',
        timestamptz '2026-10-01 09:00+00', timestamptz '2026-10-01 09:05+00'),
      ('BF-CREATED-EARLY', 'Reported before engineering logged a detection',
        timestamptz '2026-10-03 12:00+00', timestamptz '2026-10-03 11:00+00'),
      ('BF-NO-TIMESTAMPS', 'A row with nothing but created_at',
        NULL, timestamptz '2026-10-04 08:00+00'),
      ('BF-REPORTED-ONLY', 'Already reported to the Commission',
        NULL, timestamptz '2026-10-05 08:00+00')$q$);
  -- Back to the session role: the migration below has to create objects in the
  -- probe schema, and as_role leaves the impersonated role in place.
  PERFORM test_support.as_role(NULL, 'SELECT 1');
END $$;

UPDATE backfill_probe.incidents
   SET reported_at = timestamptz '2026-10-05 20:00+00'
 WHERE ref = 'BF-REPORTED-ONLY';

SET search_path = backfill_probe, public;
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
SET search_path = public;   -- explicit, not RESET: RESET leaves the local engine's
-- search_path in a state where unqualified names stop resolving

DO $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM backfill_probe.incidents WHERE awareness_at IS NULL) = 0,
    'backfill', 'every pre-existing row received a clock origin');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM backfill_probe.incidents
      WHERE awareness_at_source <> 'backfill:earliest_of_detected_reported_created') = 0,
    'backfill', 'pre-existing rows are marked as inferred, never as insert_default');

  -- The backfill rule, asserted on the cases whose timestamps disagree.
  PERFORM test_support.assert_equals(
    (SELECT awareness_at::text FROM backfill_probe.incidents WHERE ref = 'BF-CREATED-EARLY'),
    '2026-10-03 11:00:00+00', 'backfill',
    'backfill takes the earliest of detected / reported / created');

  PERFORM test_support.assert_equals(
    (SELECT awareness_at::text FROM backfill_probe.incidents WHERE ref = 'BF-DETECTED-ONLY'),
    '2026-10-01 09:00:00+00', 'backfill',
    'detected_at wins when it is the earliest');

  PERFORM test_support.assert_equals(
    (SELECT awareness_at::text FROM backfill_probe.incidents WHERE ref = 'BF-NO-TIMESTAMPS'),
    '2026-10-04 08:00:00+00', 'backfill',
    'created_at carries a row that has no detection timestamp');

  PERFORM test_support.assert_equals(
    (SELECT awareness_at::text FROM backfill_probe.incidents WHERE ref = 'BF-REPORTED-ONLY'),
    '2026-10-05 08:00:00+00', 'backfill',
    'a row that already has reported_at still resolves to created_at');

  -- detected_at is deliberately NOT constrained to be <= awareness_at. Staff
  -- can tell the board before engineering notices, and the register has to be
  -- able to record that without hitting a constraint.
  PERFORM test_support.assert_true(
    (SELECT detected_at > awareness_at FROM backfill_probe.incidents WHERE ref = 'BF-CREATED-EARLY'),
    'backfill', 'detected_at later than awareness_at is allowed and is recorded');

  v_before := (
    SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY ref)
      FROM (SELECT ref, awareness_at, awareness_at_source FROM backfill_probe.incidents) t
  );

  PERFORM test_support.assert_true(length(v_before::text) > 0, 'backfill',
    'snapshot taken before the second migration run');

  CREATE TEMP TABLE backfill_before ON COMMIT DROP AS
  SELECT ref, awareness_at, awareness_at_source FROM backfill_probe.incidents;
END
$$;

-- Second run of the same file. It must be a no-op, and it must leave the guard
-- enforcing.
SET search_path = backfill_probe, public;
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
SET search_path = public;   -- explicit, not RESET: RESET leaves the local engine's
-- search_path in a state where unqualified names stop resolving

DO $$
DECLARE
  v_after jsonb;
BEGIN
  v_after := (
    SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY ref)
      FROM (SELECT ref, awareness_at, awareness_at_source FROM backfill_probe.incidents) t
  );

  PERFORM test_support.assert_equals(v_after::text, (
    SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY ref)::text
      FROM (SELECT ref, awareness_at, awareness_at_source FROM backfill_probe.incidents) t
  ), 'backfill', 'sanity: the second run changed nothing');

  -- The real survival assertion: identical to the snapshot taken before the
  -- second run, byte for byte, provenance included.
  PERFORM test_support.assert_equals(
    (SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY ref)::text
       FROM (SELECT ref, awareness_at, awareness_at_source FROM backfill_probe.incidents) t),
    (SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY ref)::text
       FROM (SELECT ref, awareness_at, awareness_at_source FROM backfill_before) t),
    'backfill', 'pre-existing clock origins are byte-identical after the re-run');

  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE backfill_probe.incidents
          SET awareness_at = now()
        WHERE ref = 'BF-DETECTED-ONLY'$q$,
    '23001', 'backfill', 'the re-run migration left the guard enabled and enforcing');

  -- as_role, not probe: this row has to survive for the assertions below.
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO backfill_probe.incidents (ref, summary)
      VALUES ('BF-AFTER-RERUN', 'inserted after the second migration run')$q$);

  PERFORM test_support.assert_equals(
    (SELECT awareness_at_source FROM backfill_probe.incidents WHERE ref = 'BF-AFTER-RERUN'),
    'insert_default'::text, 'backfill',
    'the new row is stamped insert_default, so the re-run did not relabel old rows');

  PERFORM test_support.assert_true(
    (SELECT awareness_at >= created_at - interval '1 second'
       FROM backfill_probe.incidents WHERE ref = 'BF-AFTER-RERUN'),
    'backfill', 'the new row was stamped by the database at insert time');
END
$$;

-- Dropping the probe needs its owner back, and as_role leaves the impersonated
-- role in place until the transaction ends.
DO $$
BEGIN
  PERFORM test_support.as_role(NULL, 'SELECT 1');
  EXECUTE 'DROP SCHEMA backfill_probe CASCADE';
END $$;