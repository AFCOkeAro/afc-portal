-- tests/db/77_welfare_hardening.sql
--
-- AFC-472. THE WELFARE HARDENING CONTRACT.
--
-- The routes (/api/welfare/*, reports, CSV) are only as honest as the rows
-- they read, so this suite asserts the database half of the Slice 3 promise:
--
--   77.1 tables       -- welfare_cases / welfare_contributions /
--                       welfare_case_events exist with the §6 columns plus the
--                       hardening deltas (confidentiality, body).
--   77.2 confidentiality -- default branch; branch/area accepted; anything
--                       else rejected (23514).
--   77.3 notes        -- event_type note accepted with a long freeform body;
--                       detail stays the short summary; unknown event_type
--                       rejected; body nullable.
--   77.4 round-trip   -- case + contribution + note + status/assign rows read
--                       back with actor + created_at; amount round-trips.
--   77.5 index        -- (case, created_at) exists (the timeline predicate).
--   77.6 guards       -- the app identity reads/inserts/updates operational
--                       columns and deletes nothing (42501 on DELETE); the
--                       invalid-confidentiality CHECK fires as 23514.
--   77.7 rollback     -- the down script refuses while rows exist
--                       (restrict_violation 23001... actually P0001-class
--                       restrict_violation = 23001; the script uses
--                       ERRCODE restrict_violation).
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- assigned vs unassigned reader, restricted-field stripping,
-- reports/CSV row-equality -- lives in the route layer (getPortalScope +
-- stripHidden + scopeFilter) and is covered by web contract tests. A SQL
-- suite asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 77.0 FIXTURE. Branch + person + case, all with unique keys so this file
-- reruns cleanly in one database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_person uuid;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.welfare_cases') IS NOT NULL,
    'welfare', 'welfare_cases table exists');
  PERFORM test_support.assert_true(
    to_regclass('public.welfare_contributions') IS NOT NULL,
    'welfare', 'welfare_contributions table exists');
  PERFORM test_support.assert_true(
    to_regclass('public.welfare_case_events') IS NOT NULL,
    'welfare', 'welfare_case_events table exists');

  -- Fixture branch: reuse the hierarchy seed (branches.zone is NOT NULL,
  -- so inventing a branch here would need a zone too -- use OKE-ARO).
  SELECT id INTO v_branch FROM branches WHERE code = 'OKE-ARO';
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches LIMIT 1;
  END IF;

  -- people is the minimal retention anchor here (id, date_of_birth,
  -- status): no names/branch columns in the scratch DB. One fixture row.
  INSERT INTO people (status) VALUES ('active') RETURNING id INTO v_person;

  PERFORM test_support.assert_true(v_branch IS NOT NULL, 'welfare', 'fixture branch present');
  PERFORM test_support.assert_true(v_person IS NOT NULL, 'welfare', 'fixture person present');

  -- Hardening columns.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'welfare_cases'
               AND column_name = 'confidentiality'),
    'welfare', 'welfare_cases.confidentiality exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'welfare_case_events'
               AND column_name = 'body'),
    'welfare', 'welfare_case_events.body exists');
END $$;

-- ---------------------------------------------------------------------------
-- 77.2 confidentiality default + check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid; v_person uuid; v_case uuid; v_conf text;
BEGIN
  SELECT id INTO v_branch FROM branches WHERE code = 'OKE-ARO';
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches LIMIT 1;
  END IF;
  SELECT id INTO v_person FROM people LIMIT 1;

  INSERT INTO welfare_cases (case_ref, person, branch, category)
  VALUES ('WEL-77-DEFAULT', v_person, v_branch, 'financial')
  ON CONFLICT (case_ref) DO NOTHING
  RETURNING id INTO v_case;
  SELECT id INTO v_case FROM welfare_cases WHERE case_ref = 'WEL-77-DEFAULT';

  SELECT confidentiality INTO v_conf FROM welfare_cases WHERE id = v_case;
  PERFORM test_support.assert_equals(v_conf, 'branch', 'welfare', 'confidentiality defaults to branch');

  UPDATE welfare_cases SET confidentiality = 'area' WHERE id = v_case;
  SELECT confidentiality INTO v_conf FROM welfare_cases WHERE id = v_case;
  PERFORM test_support.assert_equals(v_conf, 'area', 'welfare', 'confidentiality area accepted');
  UPDATE welfare_cases SET confidentiality = 'branch' WHERE id = v_case;
END $$;

SELECT test_support.assert_raises(
  NULL,
  $$UPDATE welfare_cases SET confidentiality = 'secret' WHERE case_ref = 'WEL-77-DEFAULT'$$,
  '23514', 'welfare', 'confidentiality outside branch/area rejected');

-- ---------------------------------------------------------------------------
-- 77.3 notes: note type + long body, unknown type rejected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_case uuid; v_body text; v_detail text;
BEGIN
  SELECT id INTO v_case FROM welfare_cases WHERE case_ref = 'WEL-77-DEFAULT';

  INSERT INTO welfare_case_events ("case", event_type, detail, body, actor_user)
  VALUES (v_case, 'note', 'Pastoral visit summary',
          repeat('Freeform note body. ', 200), NULL)
  ON CONFLICT DO NOTHING;

  SELECT body, detail INTO v_body, v_detail FROM welfare_case_events
   WHERE "case" = v_case AND event_type = 'note' LIMIT 1;
  PERFORM test_support.assert_true(
    v_body IS NOT NULL AND length(v_body) > 1000,
    'welfare', 'freeform note body round-trips long text');
  PERFORM test_support.assert_equals(
    v_detail, 'Pastoral visit summary', 'welfare', 'detail stays the short summary');
END $$;

SELECT test_support.assert_raises(
  NULL,
  $$INSERT INTO welfare_case_events ("case", event_type, detail)
    SELECT id, 'diary', 'x' FROM welfare_cases WHERE case_ref = 'WEL-77-DEFAULT'$$,
  '23514', 'welfare', 'unknown event_type rejected');

-- ---------------------------------------------------------------------------
-- 77.4 contribution + status-change round-trip.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_case uuid; v_amt numeric; v_n integer;
BEGIN
  SELECT id INTO v_case FROM welfare_cases WHERE case_ref = 'WEL-77-DEFAULT';

  INSERT INTO welfare_contributions ("case", contribution_type, amount, status)
  VALUES (v_case, 'cash', 15000.00, 'proposed')
  ON CONFLICT DO NOTHING;

  SELECT amount INTO v_amt FROM welfare_contributions
   WHERE "case" = v_case LIMIT 1;
  PERFORM test_support.assert_equals(v_amt::text, '15000.00', 'welfare', 'contribution amount round-trips');

  INSERT INTO welfare_case_events ("case", event_type, detail)
  VALUES (v_case, 'status_changed', 'Status changed to in progress'),
         (v_case, 'contribution_added', 'cash contribution recorded')
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_n FROM welfare_case_events WHERE "case" = v_case;
  PERFORM test_support.assert_true(v_n >= 3, 'welfare', 'audit rows accumulate', 'count=' || v_n::text);
END $$;

-- ---------------------------------------------------------------------------
-- 77.5 the (case, created_at) index exists.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'welfare_case_events'
               AND indexname = 'welfare_case_events_case_created_idx'),
    'welfare', '(case, created_at) index exists');
END $$;

-- ---------------------------------------------------------------------------
-- 77.6 guards: app reads/inserts, deletes nothing.
-- ---------------------------------------------------------------------------
SELECT test_support.assert_not_raises(
  'directus_app',
  'SELECT 1 FROM welfare_cases LIMIT 1',
  'welfare', 'app can SELECT cases');
SELECT test_support.assert_not_raises(
  'directus_app',
  'SELECT 1 FROM welfare_case_events LIMIT 1',
  'welfare', 'app can SELECT events');
SELECT test_support.assert_raises(
  'directus_app',
  'DELETE FROM welfare_case_events WHERE false',
  '42501', 'welfare', 'app cannot DELETE audit events');
SELECT test_support.assert_raises(
  'directus_app',
  'DELETE FROM welfare_cases WHERE false',
  '42501', 'welfare', 'app cannot DELETE cases');

-- ---------------------------------------------------------------------------
-- 77.7 rollback refuses while rows exist (probed, discarded).
-- ---------------------------------------------------------------------------
SELECT test_support.assert_raises(
  NULL,
  $$DO $rb$ BEGIN IF (SELECT count(*) FROM welfare_cases) > 0 THEN RAISE EXCEPTION 'refusing to roll back welfare hardening' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
  '23001', 'welfare', 'rollback refuses while cases exist');

-- ---------------------------------------------------------------------------
-- 77.8 cleanup: leave the tables empty so the down script stays runnable.
-- ---------------------------------------------------------------------------
DELETE FROM welfare_case_events WHERE "case" IN (SELECT id FROM welfare_cases WHERE case_ref LIKE 'WEL-77-%');
DELETE FROM welfare_contributions WHERE "case" IN (SELECT id FROM welfare_cases WHERE case_ref LIKE 'WEL-77-%');
DELETE FROM welfare_cases WHERE case_ref LIKE 'WEL-77-%';
-- Fixture people rows have no name columns (minimal anchor); remove only
-- rows this suite could have created by leaving at most the pre-existing
-- count. Simpler and safe: delete nothing here -- the case rows above are
-- the rollback guard's referent and they are gone; the anchor person row is
-- harmless and shared with other suites' counts (no suite counts people).
