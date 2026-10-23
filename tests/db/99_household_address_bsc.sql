-- tests/db/99_household_address_bsc.sql
--
-- AFC-771 (parent AFC-460). THE STRUCTURED-ADDRESS + BSC-LINK CONTRACT.
--
-- Migration 20261023_0041 adds structured address columns + geo pins on
-- households (backfilling address_1 from the legacy line) and a nullable
-- people.bsc link to bible_study_centres.
--
--   99.1  shape         -- the eight households columns exist, nullable;
--                           the fixed-name lat/lng CHECKs and the
--                           people_bsc_fkey exist.
--   99.2  ranges        -- out-of-range pins fail (23514); a dangling bsc
--                           fails (23503); NULLs write (unpinned history).
--   99.3  guards        -- the app identity INSERTs/UPDATEs the new
--                           columns and deletes nothing; the 0004/0020
--                           ceilings hold.
--   99.4  rerun         -- re-applying 20261023_0041 changes nothing and
--                           re-runs the address_1 backfill idempotently.
--   99.5  empty rollback -- with all-NULL bsc/geo the down script drops
--                           the columns + constraint + FK; the forward
--                           file is re-applied after.
--   99.6  acceptance    -- a wizard-shaped household (structured address
--                           + composed legacy line + pin) with a member
--                           linked to a real centre reads back whole.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch/BSC scope 403s, composed-address writes, consent rows -- lives
-- in the route layer and is covered by
-- tests/web/household-wizard.contract.mjs. No retention probe: address
-- and centre links are family facts, not retention clocks; erasure runs
-- as retention_worker.

-- Suite 85 drops and recreates households via the 0020 down/up cycle, which
-- wipes any later ALTER columns and moves table ownership to the suite role.
-- Re-apply 0041 idempotently and restore migrator ownership so this suite is
-- order-independent (same pattern as 85 re-applying 0027 after its cycle).
\i services/directus/schema/migrations/20261023_0041_household_address_bsc.sql
ALTER TABLE households OWNER TO directus_migrator;
ALTER TABLE people OWNER TO directus_migrator;

-- ---------------------------------------------------------------------------
-- 99.1  SHAPE. The columns, their nullability, the fixed-name CHECKs, the FK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
BEGIN
  FOR v_nullable IN
    SELECT unnest(ARRAY['address_1','address_2','city','state','zip','country','latitude','longitude'])
  LOOP
    PERFORM test_support.assert_true(
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'households'
                 AND column_name = v_nullable), 'households',
      'households.' || v_nullable || ' exists (ALTER, never a forked households table)');
  END LOOP;

  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'households'
     AND column_name = 'address_1';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'households',
    'households.address_1 is nullable (history without parts is unknown, not blank)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'bsc'), 'households',
    'people.bsc exists (ALTER, never a forked people table)');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('households_lat_check','households_lng_check')) = 2, 'households',
    'lat/lng CHECKs exist under their fixed names (decimal degrees, NULL when unpinned)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_bsc_fkey'), 'households',
    'people_bsc_fkey exists under its fixed name (closed centre clears the link)');
END $$;

-- ---------------------------------------------------------------------------
-- 99.2  RANGES. Bad pins and dangling links fail loudly; NULLs write.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_house_probe uuid;
  v_person_probe uuid;
BEGIN
  INSERT INTO households DEFAULT VALUES RETURNING id INTO v_house_probe;

  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE households SET latitude = 91 WHERE id = $q$ ||
     '''' || v_house_probe::text || '''',
    '23514', 'households', 'latitude above 90 is rejected (decimal degrees, not invented)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE households SET longitude = 200 WHERE id = $q$ ||
     '''' || v_house_probe::text || '''',
    '23514', 'households', 'longitude above 180 is rejected');

  UPDATE households SET latitude = 6.524400, longitude = 3.379200 WHERE id = v_house_probe;
  PERFORM test_support.assert_true(
    (SELECT latitude FROM households WHERE id = v_house_probe) = 6.524400, 'households',
    'a Lagos pin writes (numeric(9,6), same shape as BSC geo)');
  UPDATE households SET latitude = NULL, longitude = NULL WHERE id = v_house_probe;

  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person_probe;
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE people SET bsc = '00000000-0000-0000-0000-000000000000' WHERE id = $q$ ||
     '''' || v_person_probe::text || '''',
    '23503', 'households', 'a dangling BSC link is rejected (no silent orphan)');
  UPDATE people SET bsc = NULL WHERE id = v_person_probe;
  PERFORM test_support.assert_true(
    (SELECT bsc FROM people WHERE id = v_person_probe) IS NULL, 'households',
    'NULL bsc writes (history without a centre stays unknown)');

  DELETE FROM households WHERE id = v_house_probe;
END $$;

-- ---------------------------------------------------------------------------
-- 99.3  GUARDS. The app writes the new columns; the ceilings hold.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE households SET city = NULL WHERE id IS NULL$q$,
    'households', 'app UPDATEs the structured address (wizard + corrections)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE people SET bsc = NULL WHERE id IS NULL$q$,
    'households', 'app UPDATEs the member BSC link');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM households WHERE false$q$,
    '42501', 'households', 'app cannot DELETE households (0020 ceiling holds)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM people WHERE false$q$,
    '42501', 'households', 'app cannot DELETE people (0004 ceiling holds)');
END $$;

-- ---------------------------------------------------------------------------
-- 99.4  RERUN. Re-applying 20261023_0041 changes nothing; the backfill is
--        idempotent (a legacy-only row gains address_1 exactly once).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy uuid;
BEGIN
  INSERT INTO households (name, address) VALUES ('Legacy House', '14 Church St, Ikeja')
    RETURNING id INTO v_legacy;
  UPDATE households SET address_1 = NULL WHERE id = v_legacy;
END $$;

\i services/directus/schema/migrations/20261023_0041_household_address_bsc.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT address_1 FROM households WHERE name = 'Legacy House') = '14 Church St, Ikeja', 'households',
    'rerun: legacy address backfilled into address_1 (no data loss at the split)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('households_lat_check','households_lng_check')) = 2, 'households',
    'rerun: exactly one lat CHECK and one lng CHECK (fixed names, no dup)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint WHERE conname = 'people_bsc_fkey') = 1, 'households',
    'rerun: exactly one people_bsc_fkey (fixed name, no dup)');
END $$;

-- ---------------------------------------------------------------------------
-- 99.5  EMPTY ROLLBACK. With all-NULL bsc/geo the down script drops the
--        columns + checks + FK; the forward file is re-applied after.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261023_0041_household_address_bsc.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'households'
                   AND column_name IN ('address_1','latitude','longitude')), 'households',
    'empty rollback: structured address + geo dropped with no pins assigned');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'people'
                   AND column_name = 'bsc'), 'households',
    'empty rollback: bsc dropped with no links assigned');
END $$;

\i services/directus/schema/migrations/20261023_0041_household_address_bsc.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'households'
               AND column_name = 'address_1'), 'households',
    'forward re-applied after rollback: address_1 back');
  PERFORM test_support.assert_true(
    (SELECT address_1 FROM households WHERE name = 'Legacy House') = '14 Church St, Ikeja', 'households',
    'forward re-applied after rollback: backfill restored (legacy line intact)');
END $$;

-- ---------------------------------------------------------------------------
-- 99.6  ACCEPTANCE. A wizard-shaped household (structured address +
--        composed legacy line + pin) with a member on a real centre.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_area uuid;
  v_zone uuid;
  v_branch uuid;
  v_bsc uuid;
  v_house uuid;
  v_head uuid;
BEGIN
  INSERT INTO areas (name, code) VALUES ('Suite Area 99', 'SUITE99-AREA')
    RETURNING id INTO v_area;
  INSERT INTO zones (area, name, code) VALUES (v_area, 'Suite Zone 99', 'SUITE99-ZONE')
    RETURNING id INTO v_zone;
  INSERT INTO branches (zone, name, code) VALUES (v_zone, 'Suite Branch 99', 'SUITE99-BRANCH')
    RETURNING id INTO v_branch;
  INSERT INTO bible_study_centres (parent_branch, name, code)
    VALUES (v_branch, 'Suite BSC 99', 'SUITE99-BSC')
    RETURNING id INTO v_bsc;

  INSERT INTO households (name, branch, address_1, city, state, country, latitude, longitude, address)
    VALUES ('Wizard House 99', v_branch, '14 Church St', 'Ikeja', 'Lagos', 'Nigeria',
            6.524400, 3.379200, '14 Church St, Ikeja, Lagos, Nigeria')
    RETURNING id INTO v_house;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_head;
  -- membership_status is snapshot-owned (absent from scratch); the suite
  -- pins the link columns only, like 91.6 pins the role columns only.
  UPDATE people
     SET household = v_house, household_role = 'head_of_household',
         branch = v_branch, bsc = v_bsc
   WHERE id = v_head;
  UPDATE households SET household_head = v_head WHERE id = v_house;

  PERFORM test_support.assert_true(
    (SELECT address FROM households WHERE id = v_house) = '14 Church St, Ikeja, Lagos, Nigeria'
    AND (SELECT address_1 FROM households WHERE id = v_house) = '14 Church St', 'households',
    'acceptance: structured parts and the composed legacy line read back together');
  PERFORM test_support.assert_true(
    (SELECT bsc FROM people WHERE id = v_head) = v_bsc
    AND (SELECT branch FROM people WHERE id = v_head) = v_branch, 'households',
    'acceptance: member branch + BSC persist and read back');
  PERFORM test_support.assert_true(
    (SELECT household_head FROM households WHERE id = v_house) = v_head
    AND (SELECT household_role FROM people WHERE id = v_head) = 'head_of_household', 'households',
    'acceptance: head link + head role name the same row');

  -- Release the links; anchor rows stay (retention-managed). NULL the
  -- new columns so a later 99.5-style rollback stays honest. Codes are
  -- suite-unique; hierarchy rows are removed in dependency order.
  UPDATE people SET household = NULL, household_role = NULL, branch = NULL, bsc = NULL
   WHERE id = v_head;
  DELETE FROM households WHERE id = v_house OR name IN ('Legacy House');
  DELETE FROM bible_study_centres WHERE id = v_bsc;
  DELETE FROM branches WHERE id = v_branch;
  DELETE FROM zones WHERE id = v_zone;
  DELETE FROM areas WHERE id = v_area;
END $$;
