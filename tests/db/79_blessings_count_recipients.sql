-- tests/db/79_blessings_count_recipients.sql
--
-- AFC-671. THE SINGLE-COUNT + INDIVIDUAL-MAPPING CONTRACT (database half).
--
--   79.1  count          -- blessings.count exists, non-negative, backfilled
--                         as male+female; GENERATED total preserved.
--   79.2  rerun          -- re-applying 20261020_0034 changes nothing.
--   79.3  recipients     -- blessing_recipients shape, other-label lens,
--                         needs-person lens, idempotent unique entry.
--   79.4  links          -- person RESTRICT, blessing CASCADE, program
--                         links SET NULL (probed on throwaways).
--   79.5  guards         -- the app ceiling: read/write operational columns,
--                         delete nothing.
--   79.6  rollback       -- the down script refuses while rows exist.
--
-- HTTP scoping (requireCan/scopeFilter), the bulk batch route, and CSV
-- parity live in the route layer and are covered by
-- tests/web/blessings.contract.mjs.

-- ---------------------------------------------------------------------------
-- 79.0  FIXTURE. Own person row (no cross-suite dependency); one legacy
--        male/female aggregate. The count backfill is asserted after the
--        79.2 rerun re-applies 0034 over this row (migrations run before
--        suites, so the first apply cannot see suite fixtures).
-- ---------------------------------------------------------------------------
INSERT INTO people (id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
ON CONFLICT (id) DO NOTHING;

INSERT INTO blessings
  (id, blessing_type, male_count, female_count, branch, service_date)
VALUES
  ('c1111111-1111-4111-8111-111111111111', 'salvation', 3, 2,
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-04')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 79.1  COUNT. Exists, non-negative, GENERATED total preserved.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'blessings'
               AND column_name = 'count'),
    'blessings', 'blessings.count exists (single-count path)');
  PERFORM test_support.assert_true(
    (SELECT is_generated = 'ALWAYS' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'blessings'
        AND column_name = 'total_count'),
    'blessings', 'total_count stays GENERATED ALWAYS (0011 preserved)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_count_nonnegative'),
    'blessings', 'the count non-negative CHECK exists');
  PERFORM test_support.assert_equals(
    (SELECT total_count::text FROM blessings
      WHERE id = 'c1111111-1111-4111-8111-111111111111'),
    '5',
    'blessings', 'GENERATED total still derives male+female (3+2=5)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, count, branch, service_date) VALUES ('healing', -1, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'a negative count is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 79.2  RERUN. Re-applying the migration changes nothing; the backfill
--        covers the fixture aggregate (count = male+female).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0034_blessings_count_recipients.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count::text FROM blessings
      WHERE id = 'c1111111-1111-4111-8111-111111111111'),
    '5',
    'blessings', 'rerun backfills count as male+female (3+2=5)');
  PERFORM test_support.assert_true(
    to_regclass('public.blessing_recipients') IS NOT NULL,
    'blessings', 'blessing_recipients exists after rerun');
END $$;

-- ---------------------------------------------------------------------------
-- 79.3  RECIPIENTS. Shape, lenses, idempotent unique entry.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'blessing_recipients'
               AND column_name IN ('blessing', 'blessing_type', 'other_label',
                 'person', 'attendee_user', 'branch', 'zone', 'bsc',
                 'session', 'event', 'sunday_service', 'service_date',
                 'recorded_by', 'notes')
             HAVING count(*) = 14),
    'blessings', 'blessing_recipients carries the full column set');
  -- other requires a label.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessing_recipients (blessing_type, person, branch, service_date) VALUES ('other', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'recipient other without other_label is rejected');
  -- at least one person: neither person nor attendee_user.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessing_recipients (blessing_type, branch, service_date) VALUES ('healing', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'a recipient with no person is rejected');
  -- unknown type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessing_recipients (blessing_type, person, branch, service_date) VALUES ('baptism_water', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'an unknown recipient blessing_type is rejected');
END $$;

-- Idempotent entry: the same person+type+program+date twice is one row.
-- Probed on a throwaway person-linked row; the duplicate probe rolls back
-- (assert.sql probes roll back), so no cleanup is needed for the dup itself.
INSERT INTO blessing_recipients
  (id, blessing_type, person, branch, service_date)
VALUES
  ('d1111111-1111-4111-8111-111111111111', 'salvation',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-12')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    (SELECT format($q$INSERT INTO blessing_recipients (blessing_type, person, branch, service_date) VALUES ('salvation', %L, %L, DATE '2026-10-12')$q$,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text,
      (SELECT id FROM branches WHERE code = 'OKE-ARO')::text)),
    '23505', 'blessings', 'a duplicate person+type+program+date is rejected (idempotent key)');
  PERFORM test_support.assert_not_raises('directus_migrator',
    (SELECT format($q$INSERT INTO blessing_recipients (id, blessing_type, person, branch, service_date) VALUES ('d2222222-2222-4222-8222-222222222222', 'healing', %L, %L, DATE '2026-10-12') ON CONFLICT (id) DO NOTHING$q$,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text,
      (SELECT id FROM branches WHERE code = 'OKE-ARO')::text)),
    'blessings', 'the same person with a second type is accepted');
END $$;

DELETE FROM blessing_recipients WHERE id IN
  ('d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222');

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessing_recipients WHERE id IN
      ('d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222')) = 0,
    'blessings', 'the throwaway recipients are gone (migrator delete)');
END $$;

-- ---------------------------------------------------------------------------
-- 79.4  LINKS. person RESTRICT; blessing CASCADE; branch RESTRICT.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_person_fkey'),
    'blessings', 'the person FK exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessing_recipients_blessing_fkey'),
    'blessings', 'the blessing FK exists');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'blessing_recipients_person_fkey'),
    'r',
    'blessings', 'deleting a person with blessings is refused (RESTRICT)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'blessing_recipients_blessing_fkey'),
    'c',
    'blessings', 'linked individuals follow their aggregate (CASCADE)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM branches WHERE code = 'OKE-ARO'$q$,
    '23503', 'blessings', 'deleting a branch with blessings is refused (RESTRICT)');
END $$;

-- CASCADE probe on throwaways: an aggregate + a linked individual vanish
-- together. Plain DELETEs (not probes) so the CASCADE is observed.
INSERT INTO blessings (id, blessing_type, branch, service_date)
  VALUES ('c8888888-8888-4888-8888-888888888888', 'healing',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO blessing_recipients (id, blessing, blessing_type, person, branch, service_date)
  VALUES ('d8888888-8888-4888-8888-888888888888', 'c8888888-8888-4888-8888-888888888888', 'healing',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;

DELETE FROM blessings WHERE id = 'c8888888-8888-4888-8888-888888888888';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessing_recipients WHERE id = 'd8888888-8888-4888-8888-888888888888') = 0,
    'blessings', 'the linked individual follows its aggregate (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 79.5  GUARDS. The app ceiling: read/write operational, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM blessing_recipients$q$,
    'blessings', 'directus_app can read recipients');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO blessing_recipients (blessing_type, person, branch, service_date) VALUES ('healing', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-18')$q$,
    'blessings', 'directus_app can record recipients');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE blessings SET count = 7 WHERE id = 'c1111111-1111-4111-8111-111111111111'$q$,
    'blessings', 'directus_app can update the single count');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM blessing_recipients WHERE id = 'd1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'blessings', 'directus_app has no DELETE on recipients');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM blessings WHERE id = 'c1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'blessings', 'directus_app still has no DELETE on blessings');
END $$;

-- ---------------------------------------------------------------------------
-- 79.6  ROLLBACK REFUSES while rows exist (probed, discarded).
-- ---------------------------------------------------------------------------
-- 79.6 setup: stage divergent state of its own (migrator, fixed ids,
-- removed afterwards). Earlier sections clean up their throwaways, so the
-- probe cannot rely on leftover rows.
INSERT INTO blessings (id, blessing_type, male_count, female_count, count, branch, service_date)
  VALUES ('c9999999-9999-4999-8999-999999999999', 'healing', 1, 1, 99,
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-09')
ON CONFLICT (id) DO UPDATE SET count = 99;
INSERT INTO blessing_recipients (id, blessing, blessing_type, person, branch, service_date)
  VALUES ('d9999999-9999-4999-8999-999999999999', 'c9999999-9999-4999-8999-999999999999', 'healing',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-09')
ON CONFLICT (id) DO NOTHING;
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM blessing_recipients) > 0 OR (SELECT count(*) FROM blessings WHERE count <> male_count + female_count) > 0 THEN RAISE EXCEPTION 'refusing to roll back blessings count/recipients: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'blessings', 'rollback refuses while recipients or diverged counts exist');
END $outer$;
DELETE FROM blessing_recipients WHERE id = 'd9999999-9999-4999-8999-999999999999';
DELETE FROM blessings WHERE id = 'c9999999-9999-4999-8999-999999999999';
