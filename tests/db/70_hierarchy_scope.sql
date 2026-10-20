-- tests/db/70_hierarchy_scope.sql
--
-- AFC-466 / AFC-461a. THE HIERARCHY SCOPE CONTRACT.
--
-- The routes (/api/branches, /api/zones, /api/bscs) enforce zone/branch
-- isolation with Directus filters over denorm columns (portal.ts
-- branchCollectionScope / zoneScopeFilter). A filter is only as honest as
-- the columns it reads, so this suite asserts the database half of that
-- promise -- the half a crafted HTTP request cannot change:
--
--   70.1  seed shape    -- Lagos North loads: 1 area, 6 zones, 7 branches,
--                         9 BSCs; every branch carries a zone; every branch
--                         area equals its zone's area; every BSC zone equals
--                         its parent branch's zone; the satellite hangs under
--                         a branch (parent_branch) while its zone stays Z1
--                         (parent_branch and zone are distinct relations).
--   70.2  rerun         -- re-applying 20261020_0002 changes nothing
--                         (ON CONFLICT DO NOTHING on code; counts identical).
--   70.3  partition     -- zone predicates partition the row sets: a Z1
--                         filter returns exactly Z1's rows and none of Z2's.
--                         Zone isolation at HTTP rests on this disjointness.
--   70.4  guards        -- unique codes reject duplicates; a zone holding
--                         branches cannot be deleted (RESTRICT); the app
--                         identity reads hierarchy rows and cannot DELETE
--                         any of them; campus_institutions is read-only to
--                         the app (reference data, Slice 5 owns writes).
--   70.5  merge         -- the WECA branch FKs the 0002 file promised in §9
--                         exist, so finance rows can no longer name a branch
--                         that is not a branches row.
--   70.6  conditional   -- attendance_sessions / households / directus_users
--                         are absent from the scratch DB, so the migration
--                         must have skipped their denorm columns loudly rather
--                         than creating tables another migration owns.
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a zone admin's cross-zone request rejected, a branch admin's
-- cross-branch request empty, a scopeless session failed closed -- lives in
-- the route layer (getPortalScope + requireZoneInScope) and is covered there.
-- A SQL suite asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 70.1  SEED SHAPE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_areas integer; v_zones integer; v_branches integer; v_bsc integer;
  v_zoneless integer; v_area_mismatch integer; v_bsc_mismatch integer;
BEGIN
  SELECT count(*) INTO v_areas FROM areas;
  PERFORM test_support.assert_true(v_areas = 1, 'hierarchy', 'exactly one seeded area');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM areas WHERE code = 'LAG-NORTH') = 1,
    'hierarchy', 'the seeded area is Lagos North (LAG-NORTH)');

  SELECT count(*) INTO v_zones FROM zones;
  PERFORM test_support.assert_true(v_zones = 6, 'hierarchy', 'six seeded zones');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM zones WHERE code LIKE 'LAG-NORTH-Z%') = 6,
    'hierarchy', 'all six zones carry the LAG-NORTH-Z prefix');

  SELECT count(*) INTO v_branches FROM branches;
  PERFORM test_support.assert_true(v_branches = 7, 'hierarchy', 'seven seeded branches');

  SELECT count(*) INTO v_bsc FROM bible_study_centres;
  PERFORM test_support.assert_true(v_bsc = 9, 'hierarchy', 'nine seeded BSCs');

  -- Every branch carries a zone (the hierarchy parent is required).
  SELECT count(*) INTO v_zoneless FROM branches WHERE zone IS NULL;
  PERFORM test_support.assert_true(v_zoneless = 0, 'hierarchy', 'no branch is zoneless');

  -- Denorm consistency: branch.area must equal its zone's area.
  SELECT count(*) INTO v_area_mismatch
    FROM branches b JOIN zones z ON z.id = b.zone
   WHERE b.area IS DISTINCT FROM z.area;
  PERFORM test_support.assert_true(v_area_mismatch = 0, 'hierarchy', 'branch.area agrees with zone.area on every row');

  -- Denorm consistency: BSC zone must equal its parent branch's zone.
  SELECT count(*) INTO v_bsc_mismatch
    FROM bible_study_centres c JOIN branches b ON b.id = c.parent_branch
   WHERE c.zone IS DISTINCT FROM b.zone;
  PERFORM test_support.assert_true(v_bsc_mismatch = 0, 'hierarchy', 'bsc.zone agrees with parent branch zone on every row');

  -- parent_branch and zone are distinct relations: the satellite hangs under
  -- Oke-Aro (parent_branch) while its own zone row is still Z1.
  PERFORM test_support.assert_true(
    (SELECT parent_branch FROM branches WHERE code = 'OKE-ARO-SAT-1')
      = (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'hierarchy', 'the satellite hangs under Oke-Aro via parent_branch');
  PERFORM test_support.assert_true(
    (SELECT zone FROM branches WHERE code = 'OKE-ARO-SAT-1')
      = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
    'hierarchy', 'the satellite keeps its own zone (Z1), distinct from parent_branch');

  -- The four WECA workbook branches resolve by the same codes the finance
  -- suite uses: one branch identity across features, not one per feature.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code IN ('OKE-ARO', 'LEGUN', 'MATOGUN', 'OLOMOWEWE')) = 4,
    'hierarchy', 'the four workbook branch codes exist as branches');

  -- type_label pairs with branch_type: FFC rows are full_fledged, AFWC is afwc.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE type_label = 'FFC' AND branch_type <> 'full_fledged') = 0,
    'hierarchy', 'every FFC-labelled branch is full_fledged');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'MATOGUN' AND branch_type = 'afwc' AND type_label = 'AFWC') = 1,
    'hierarchy', 'Matogun is the AFWC branch');
END $$;

-- ---------------------------------------------------------------------------
-- 70.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql

DO $$
BEGIN
  PERFORM test_support.assert_true((SELECT count(*) FROM areas) = 1, 'hierarchy', 'rerun: still one area');
  PERFORM test_support.assert_true((SELECT count(*) FROM zones) = 6, 'hierarchy', 'rerun: still six zones');
  PERFORM test_support.assert_true((SELECT count(*) FROM branches) = 7, 'hierarchy', 'rerun: still seven branches');
  PERFORM test_support.assert_true((SELECT count(*) FROM bible_study_centres) = 9, 'hierarchy', 'rerun: still nine BSCs');
END $$;

-- ---------------------------------------------------------------------------
-- 70.3  PARTITION. Zone predicates partition the row sets.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid; v_z2 uuid;
  v_z1_branches integer; v_z2_branches integer; v_overlap integer;
  v_z1_bsc integer; v_overlap_bsc integer;
BEGIN
  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';
  SELECT id INTO v_z2 FROM zones WHERE code = 'LAG-NORTH-Z2';

  -- A Z1 filter returns exactly Z1's rows: Oke-Aro + its satellite.
  SELECT count(*) INTO v_z1_branches FROM branches WHERE zone = v_z1;
  PERFORM test_support.assert_true(v_z1_branches = 2, 'hierarchy', 'Z1 filter returns exactly two branches');
  SELECT count(*) INTO v_z2_branches FROM branches WHERE zone = v_z2;
  PERFORM test_support.assert_true(v_z2_branches = 1, 'hierarchy', 'Z2 filter returns exactly one branch');

  -- And none of Z2's: the two predicates are disjoint.
  SELECT count(*) INTO v_overlap FROM branches WHERE zone = v_z1 AND zone = v_z2;
  PERFORM test_support.assert_true(v_overlap = 0, 'hierarchy', 'Z1 and Z2 branch predicates are disjoint');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE zone NOT IN (v_z1, v_z2)) = 4,
    'hierarchy', 'every other branch is outside both zones');

  -- Same for BSCs: three under Z1, two under Z2, disjoint.
  SELECT count(*) INTO v_z1_bsc FROM bible_study_centres WHERE zone = v_z1;
  PERFORM test_support.assert_true(v_z1_bsc = 3, 'hierarchy', 'Z1 filter returns exactly three BSCs');
  SELECT count(*) INTO v_overlap_bsc FROM bible_study_centres WHERE zone = v_z1 AND zone = v_z2;
  PERFORM test_support.assert_true(v_overlap_bsc = 0, 'hierarchy', 'Z1 and Z2 BSC predicates are disjoint');
END $$;

-- ---------------------------------------------------------------------------
-- 70.4  GUARDS. Uniqueness, RESTRICT, and the app ceiling.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Unique codes reject duplicates.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO areas (name, code) VALUES ('Duplicate', 'LAG-NORTH')$q$,
    '23505', 'hierarchy', 'duplicate area code is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO zones (area, name, code) VALUES ((SELECT id FROM areas WHERE code = 'LAG-NORTH'), 'Duplicate', 'LAG-NORTH-Z1')$q$,
    '23505', 'hierarchy', 'duplicate zone code is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO branches (name, code, zone) VALUES ('Duplicate', 'OKE-ARO', (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'))$q$,
    '23505', 'hierarchy', 'duplicate branch code is rejected');

  -- RESTRICT: a zone holding branches cannot be deleted by accident.
  -- Postgres reports a RESTRICT violation as 23503 foreign_key_violation
  -- (23001 is the trigger-raised restrict_violation, a different mechanism).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM zones WHERE code = 'LAG-NORTH-Z1'$q$,
    '23503', 'hierarchy', 'deleting a zone that holds branches is refused (RESTRICT)');

  -- The app identity reads hierarchy rows (an operator who cannot see the
  -- hierarchy cannot scope anything) and deletes nothing.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM areas$q$,
    'hierarchy', 'directus_app can read areas');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM zones$q$,
    'hierarchy', 'directus_app can read zones');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM branches$q$,
    'hierarchy', 'directus_app can read branches');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM bible_study_centres$q$,
    'hierarchy', 'directus_app can read BSCs');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM areas WHERE code = 'LAG-NORTH'$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on areas');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM zones WHERE code = 'LAG-NORTH-Z1'$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on zones');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM branches WHERE code = 'OKE-ARO'$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on branches');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM bible_study_centres WHERE code = 'OKE-ARO-BSC-01'$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on BSCs');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM conference_centres WHERE false$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on conference centres');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM sunday_school_classes WHERE false$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on Sunday School classes');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM avs_centres WHERE false$q$,
    '42501', 'hierarchy', 'directus_app has no DELETE on AVS centres');

  -- campus_institutions is read-only to the app: reference data whose rows
  -- land as reviewed seed/migration rows (Slice 5 owns writes).
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campus_institutions$q$,
    'hierarchy', 'directus_app can read campus institutions');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO campus_institutions (name) VALUES ('Probe campus')$q$,
    '42501', 'hierarchy', 'directus_app cannot write campus institutions');
END $$;

-- ---------------------------------------------------------------------------
-- 70.5  MERGE. The WECA branch FKs exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branch_financial_records_branch_fkey'),
    'hierarchy', 'branch_financial_records.branch now references branches(id)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weca_returns_branch_fkey'),
    'hierarchy', 'weca_returns.branch now references branches(id)');

  -- The FK is enforced, not decorative: a finance row cannot name a branch
  -- that is not a branches row.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO branch_financial_records (branch, month, income) VALUES (gen_random_uuid(), DATE '2026-02-01', 1000)$q$,
    '23503', 'hierarchy', 'a finance row naming no branch is rejected (FK)');
END $$;

-- ---------------------------------------------------------------------------
-- 70.6  CONDITIONAL. Tables owned elsewhere are skipped, not forked.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- AFC-566: attendance_sessions is no longer absent -- 20261020_0023
  -- created the register WITH the 0002/0010 denorm columns (zone, bsc,
  -- service_type_def). The no-fork invariant is now pinned positively: the
  -- table present carries the owning migration's full shape (route columns
  -- 0002 would never create, e.g. session_name/idempotency_key), so 0002's
  -- conditional ALTERs met a real register, never a fork of their own
  -- making.
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'session_name')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'idempotency_key')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'zone')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'service_type_def'),
    'hierarchy', 'attendance_sessions is 0023-owned with the full register shape (0002 met it, never forked it)');
  -- AFC-566: households is no longer absent -- 20261020_0020 created the
  -- register. The no-fork invariant is now pinned positively: the table
  -- present carries the owning migration's full shape (route columns 0002
  -- would never create, e.g. name/status), so 0002's conditional ALTERs
  -- met a real register, not a fork of their own making.
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'households'
                   AND column_name = 'name')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'households'
                   AND column_name = 'status')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'households'
                   AND column_name = 'zone')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'households'
                   AND column_name = 'household_head'),
    'hierarchy', 'households is 0020-owned with the full register shape (0002 met it, never forked it)');
  PERFORM test_support.assert_true(
    to_regclass('public.directus_users') IS NULL,
    'hierarchy', 'directus_users is absent here: scopes land in the Directus project, not a shadow table');
END $$;
