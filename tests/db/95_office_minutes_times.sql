-- tests/db/95_office_minutes_times.sql
--
-- AFC-670. THE MINUTES TIMES/LOCATION CONTRACT.
--
-- Migration 0033 adds start_time/end_time (nullable time, end > start where
-- both present) and location (nullable text) to office_minutes, and extends
-- the 0013 column-level INSERT/UPDATE lists for directus_app with exactly
-- those three columns. This suite asserts the database half:
--
--   95.1  columns       -- the three columns exist, nullable, time/time/text.
--   95.2  order         -- inverted or equal times are rejected (23514);
--                         valid and half-null times are accepted.
--   95.3  rerun         -- re-applying 0033 changes nothing (IF NOT EXISTS
--                         everywhere; the fixture row is byte-identical).
--   95.4  guards        -- directus_app writes the new columns, deletes
--                         nothing, PUBLIC holds nothing on the table.
--   95.5  rollback      -- the SHIPPED down script drops exactly what 0033
--                         added (probed inside a savepoint, then discarded);
--                         re-applying 0033 afterwards restores it.
--
-- What this suite does NOT assert (stated, not missing): the HH:MM form
-- shape and end-after-start form message (zod layer, covered by
-- tests/web/office.contract.mjs), the Markdown editor, and the HTTP
-- 400/403 halves (route layer, same file).

-- ---------------------------------------------------------------------------
-- 95.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO comes from the 0002 hierarchy seed (same pin as suite 79).
-- ---------------------------------------------------------------------------
INSERT INTO office_minutes
  (id, title, meeting_date, start_time, end_time, location, branch, status)
VALUES
  ('35111111-1111-4111-8111-111111111111',
    'Council meeting', DATE '2026-10-11', TIME '10:00', TIME '12:00',
    'Anthony Village Tabernacle, Main Hall',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'final')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 95.1  COLUMNS. Present, nullable, correct types.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND column_name = 'start_time' AND data_type = 'time without time zone'
        AND is_nullable = 'YES') = 1,
    'minutestimes', 'start_time exists as nullable time');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND column_name = 'end_time' AND data_type = 'time without time zone'
        AND is_nullable = 'YES') = 1,
    'minutestimes', 'end_time exists as nullable time');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND column_name = 'location' AND data_type = 'text'
        AND is_nullable = 'YES') = 1,
    'minutestimes', 'location exists as nullable text');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint WHERE conname = 'office_minutes_time_order') = 1,
    'minutestimes', 'the time-order CHECK exists');
END $$;

-- ---------------------------------------------------------------------------
-- 95.2  ORDER. The database rejects inverted/equal times, not just the form.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO office_minutes (title, meeting_date, start_time, end_time, branch) VALUES ('probe inverted', DATE '2026-10-12', TIME '14:00', TIME '13:00', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23514', 'minutestimes', 'inverted times are rejected (check_violation)');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO office_minutes (title, meeting_date, start_time, end_time, branch) VALUES ('probe equal', DATE '2026-10-12', TIME '14:00', TIME '14:00', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23514', 'minutestimes', 'equal times are rejected (check_violation)');
  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO office_minutes (id, title, meeting_date, start_time, end_time, location, branch) VALUES ('35999999-9999-4999-8999-999999999999', 'probe valid', DATE '2026-10-12', TIME '09:00', TIME '10:30', 'Chapel', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    'minutestimes', 'ordered times with a location are accepted');
  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO office_minutes (id, title, meeting_date, start_time, branch) VALUES ('35888888-8888-4888-8888-888888888888', 'probe half-null', DATE '2026-10-12', TIME '09:00', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    'minutestimes', 'a start with no end is accepted');
  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO office_minutes (id, title, meeting_date, branch) VALUES ('35777777-7777-4777-8777-777777777777', 'probe timeless', DATE '2026-10-12', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    'minutestimes', 'pre-670 rows without times are accepted');
  DELETE FROM office_minutes WHERE id IN
    ('35999999-9999-4999-8999-999999999999',
     '35888888-8888-4888-8888-888888888888',
     '35777777-7777-4777-8777-777777777777');
END $$;

-- ---------------------------------------------------------------------------
-- 95.3  RERUN. Re-applying 0033 changes nothing: columns are IF NOT EXISTS,
--        the CHECK is drop-then-add of the identical definition, and the
--        fixture row survives byte-identical.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0033_office_minutes_times.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM office_minutes
      WHERE id = '35111111-1111-4111-8111-111111111111'
        AND title = 'Council meeting'
        AND meeting_date = DATE '2026-10-11'
        AND start_time = TIME '10:00' AND end_time = TIME '12:00'
        AND location = 'Anthony Village Tabernacle, Main Hall'
        AND status = 'final') = 1,
    'minutestimes', 'rerun: the fixture minute survives byte-identical');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint WHERE conname = 'office_minutes_time_order') = 1,
    'minutestimes', 'rerun: exactly one time-order CHECK');
END $$;

-- ---------------------------------------------------------------------------
-- 95.4  GUARDS. The app ceiling over the new columns: write yes, delete
--        never, PUBLIC nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO office_minutes (id, title, meeting_date, start_time, end_time, location, branch, status) VALUES ('35666666-6666-4666-8666-666666666666', 'probe app write', DATE '2026-10-13', TIME '18:00', TIME '19:00', 'Youth Hall', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'draft')$q$,
    'minutestimes', 'directus_app inserts the new columns');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE office_minutes SET start_time = TIME '18:30', end_time = TIME '19:30', location = 'Main Hall' WHERE id = '35111111-1111-4111-8111-111111111111'$q$,
    'minutestimes', 'directus_app updates the new columns');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM office_minutes WHERE id = '35111111-1111-4111-8111-111111111111'$q$,
    '42501', 'minutestimes', 'directus_app still has no DELETE on office_minutes');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND grantee = 'PUBLIC') = 0,
    'minutestimes', 'PUBLIC holds no privilege on office_minutes');
  DELETE FROM office_minutes WHERE id = '35666666-6666-4666-8666-666666666666';
  UPDATE office_minutes SET start_time = TIME '10:00', end_time = TIME '12:00',
    location = 'Anthony Village Tabernacle, Main Hall'
    WHERE id = '35111111-1111-4111-8111-111111111111';
END $$;

-- ---------------------------------------------------------------------------
-- 95.5  ROLLBACK. The SHIPPED down script (not a paraphrase) drops exactly
--        what 0033 added, and re-applying 0033 afterwards restores it, so
--        the suite leaves the migrated schema intact on the green path.
--        This block runs last in the file: a red assertion aborts the rest
--        of the file, and these are the only destructive statements in it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261020_0033_office_minutes_times.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND column_name IN ('start_time', 'end_time', 'location')) = 0,
    'minutestimes', 'rollback: the three 0033 columns are gone');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint WHERE conname = 'office_minutes_time_order') = 0,
    'minutestimes', 'rollback: the time-order CHECK is gone');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM office_minutes
      WHERE id = '35111111-1111-4111-8111-111111111111') = 1,
    'minutestimes', 'rollback: minute rows survive the column drop');
END $$;

\i services/directus/schema/migrations/20261020_0033_office_minutes_times.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'office_minutes'
        AND column_name IN ('start_time', 'end_time', 'location')) = 3,
    'minutestimes', 're-apply: the three 0033 columns are back');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM office_minutes
      WHERE id = '35111111-1111-4111-8111-111111111111'
        AND start_time IS NULL AND end_time IS NULL AND location IS NULL) = 1,
    'minutestimes', 're-apply: the row is back with NULL times (a column drop destroys its values; stated, not missing)');
END $$;
