-- tests/db/40_clock.sql
--
-- AFC-166 acceptance criterion 4: the remaining-hours gauge is derived from
-- awareness_at, never from detected_at.
--
-- The fixture is built so the two derivations disagree by a wide margin. The
-- church was made aware 65 hours ago; engineering only detected it 5 hours ago.
-- A gauge reading detected_at would report ~67 hours remaining. The assertion is
-- that it reports ~7.
--
-- awareness_at is immutable, so the fixture cannot be edited into place. Instead
-- the probe copy has its *default* re-pointed at an offset, which is the same
-- mechanism production uses (the column default), then the shipped migration and
-- the shipped view are applied on top. Nothing about the shipped definitions is
-- adjusted -- only the input time.

CREATE SCHEMA IF NOT EXISTS clock_probe;

CREATE TABLE clock_probe.incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE,
  summary       text NOT NULL,
  severity      text NOT NULL DEFAULT 'minor',
  status        text NOT NULL DEFAULT 'open',
  detected_at   timestamptz,
  reported_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

SET search_path = clock_probe, public;
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
RESET search_path;

-- Re-point the default to age the clock. This is the same lever the migration
-- uses to stamp rows; only the offset differs.
ALTER TABLE clock_probe.incidents
  ALTER COLUMN awareness_at DROP DEFAULT,
  ALTER COLUMN awareness_at SET DEFAULT (now() - interval '65 hours');

INSERT INTO clock_probe.incidents (ref, summary, severity, status, detected_at)
VALUES ('CLOCK-65H', 'Aware 65 hours ago, detected 5 hours ago', 'critical', 'open',
        now() - interval '5 hours');

ALTER TABLE clock_probe.incidents
  ALTER COLUMN awareness_at DROP DEFAULT,
  ALTER COLUMN awareness_at SET DEFAULT (now() - interval '80 hours');

INSERT INTO clock_probe.incidents (ref, summary, severity, status, detected_at)
VALUES ('CLOCK-80H', 'Aware 80 hours ago, past the deadline', 'critical', 'open',
        now() - interval '2 hours');

ALTER TABLE clock_probe.incidents
  ALTER COLUMN awareness_at DROP DEFAULT,
  ALTER COLUMN awareness_at SET DEFAULT (now() - interval '1 hour');

INSERT INTO clock_probe.incidents (ref, summary, severity, status, detected_at)
VALUES ('CLOCK-1H', 'Aware an hour ago, healthy', 'minor', 'open',
        now() - interval '1 hour');

DO $$
DECLARE
  v65            numeric;
  v65_detected   numeric;
  v80            numeric;
  v1             numeric;
  v65_source     text;
  v65_due_delta  numeric;
BEGIN
  SELECT remaining_hours INTO v65
    FROM clock_probe.incidents_breach_clock WHERE ref = 'CLOCK-65H';
  SELECT remaining_hours INTO v80
    FROM clock_probe.incidents_breach_clock WHERE ref = 'CLOCK-80H';
  SELECT remaining_hours INTO v1
    FROM clock_probe.incidents_breach_clock WHERE ref = 'CLOCK-1H';

  -- What a detected_at-derived gauge would have said. If these two numbers were
  -- equal the test could not tell a correct gauge from a wrong one.
  SELECT round((72 - EXTRACT(EPOCH FROM (now() - detected_at)) / 3600)::numeric, 2)
    INTO v65_detected
    FROM clock_probe.incidents WHERE ref = 'CLOCK-65H';

  PERFORM test_support.assert_true(v65 > 6.9 AND v65 < 7.1, 'clock',
    'remaining hours for a 65-hour-old clock is ~7, read from awareness_at',
    'remaining=' || COALESCE(v65::text, 'NULL') || ' detected_at_would_say=' || COALESCE(v65_detected::text, 'NULL'));

  PERFORM test_support.assert_true(v65_detected > 66 AND v65_detected <= 67, 'clock',
    'the detected_at-derived number is ~67, so the fixture can tell the two derivations apart',
    'detected_at_would_say=' || COALESCE(v65_detected::text, 'NULL'));

  PERFORM test_support.assert_true(v65 <> v65_detected, 'clock',
    'the gauge is not the detected_at-derived number');

  PERFORM test_support.assert_true(v80 < 0 AND v80 > -8.1, 'clock',
    'a clock 80 hours old reads as breached, which is what fires the zero-hour alert',
    'remaining=' || COALESCE(v80::text, 'NULL'));

  PERFORM test_support.assert_true(v1 > 70.9 AND v1 < 71.1, 'clock',
    'a fresh clock reads ~71 hours remaining',
    'remaining=' || COALESCE(v1::text, 'NULL'));

  -- The threshold the 60-hour alert is built on has to be meaningful here.
  PERFORM test_support.assert_true(v65 <= 60, 'clock',
    'a 65-hour-old clock is past the 60-hour warning threshold');
  PERFORM test_support.assert_true(v1 > 60, 'clock',
    'a 1-hour-old clock is not past the 60-hour warning threshold');

  -- The due date is the clock origin plus 72 hours, exactly.
  SELECT awareness_at_source INTO v65_source
    FROM clock_probe.incidents WHERE ref = 'CLOCK-65H';
  PERFORM test_support.assert_equals(v65_source, 'insert_default', 'clock',
    'the probe row is stamped insert_default, so it is server-set evidence');

  SELECT round(EXTRACT(EPOCH FROM (notification_due_at - awareness_at)) / 3600)
    INTO v65_due_delta
    FROM clock_probe.incidents_breach_clock WHERE ref = 'CLOCK-65H';
  PERFORM test_support.assert_equals(v65_due_delta::text, '72', 'clock',
    'notification_due_at is exactly 72 hours after the clock origin');

  -- Closing a breach takes it off the clock; the row stays.
  UPDATE clock_probe.incidents SET status = 'closed' WHERE ref = 'CLOCK-1H';
  PERFORM test_support.assert_equals(
    (SELECT count(*) FROM clock_probe.incidents_breach_clock WHERE ref = 'CLOCK-1H'),
    '0', 'clock', 'a closed breach is off the clock but still in the register');
  PERFORM test_support.assert_equals(
    (SELECT count(*) FROM clock_probe.incidents WHERE ref = 'CLOCK-1H'),
    '1', 'clock', 'a closed breach is not deleted');
END
$$;

DROP SCHEMA clock_probe CASCADE;

-- ---------------------------------------------------------------------------
-- The same guarantees on the live register, through the shipped view.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_remaining numeric;
  v_due       timestamptz;
BEGIN
  SET LOCAL ROLE directus_app;
  INSERT INTO incidents (ref, summary, severity, status, detected_at)
  VALUES ('CLOCK-LIVE', 'Live fixture for the clock assertions', 'critical', 'open',
          now() - interval '5 hours');
  RESET ROLE;

  SELECT remaining_hours, notification_due_at INTO v_remaining, v_due
    FROM incidents_breach_clock WHERE ref = 'CLOCK-LIVE';

  PERFORM test_support.assert_true(v_remaining > 71.9 AND v_remaining <= 72, 'clock',
    'a freshly filed incident has ~72 hours remaining',
    'remaining=' || COALESCE(v_remaining::text, 'NULL'));

  PERFORM test_support.assert_true(v_due > now() AND v_due <= now() + interval '72 hours',
    'clock', 'notification_due_at is within the next 72 hours',
    'due=' || COALESCE(v_due::text, 'NULL'));

  -- The invariants the monitoring rules watch. A non-zero count on either is a
  -- broken migration, so they are asserted rather than assumed.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM incidents WHERE awareness_at IS NULL) = 0,
    'clock', 'no incident has a NULL clock origin, so the alert sits at zero');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM incidents WHERE awareness_at_source IS NULL) = 0,
    'clock', 'no incident is missing its provenance');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM incidents_breach_clock WHERE clock_origin_missing) = 0,
    'clock', 'the view reports zero clock-origin gaps');

  SET LOCAL ROLE directus_app;
  UPDATE incidents SET status = 'reported' WHERE ref = 'CLOCK-LIVE';
  RESET ROLE;

  PERFORM test_support.assert_equals(
    (SELECT count(*) FROM incidents_breach_clock WHERE ref = 'CLOCK-LIVE'),
    '0', 'clock', 'a reported breach is off the clock');
END
$$;