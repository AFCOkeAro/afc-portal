-- tests/db/87_lagos_north_zones.sql
--
-- AFC-578 (parent AFC-460). THE AUTHORITATIVE-ZONE CORRECTION CONTRACT.
--
-- User correction 2026-10-20 (source sheet fetched read-only by the CTO):
-- Area Lagos North > 6 zones (Oke Aro, Sango, Ifo, Itoki, Ijoko, Agege).
-- Migration 20261020_0022 renames the six 0002-seeded zone rows BY CODE;
-- codes are the identity, names are labels. This suite asserts the database
-- half of that promise -- the half a crafted HTTP request cannot change:
--
--   87.1  names       -- the six zones read exactly the authoritative names,
--                         codes/sorts unchanged, still one area + six zones.
--   87.2  dependents  -- every FK dependent is green: 6 branches + 9 BSCs
--                         intact, no branch zoneless or re-homed, denorm
--                         consistency (branch.area = zone.area, bsc.zone =
--                         parent zone), WECA workbook branch codes resolve,
--                         RESTRICT + app ceiling hold.
--   87.3  rerun       -- re-applying 0002 then 0022 changes nothing (0002's
--                         seed is ON CONFLICT DO NOTHING on code, so it never
--                         overwrites the corrected names; 0022's UPDATEs are
--                         IS DISTINCT FROM-guarded).
--   87.4  round-trip  -- the down script restores the six 0002 names and
--                         re-applying the forward file restores the six
--                         authoritative names (rename is reversible, recode
--                         is not -- the issue's stated risk lens).
--
-- What this suite does NOT assert (stated, not missing): branch>zone
-- re-homing for the 30 sheet branches (Legun, Matogun, Olomowewe and the 21
-- others are branches-in-waiting, not zone rows) -- no branch row moves
-- without user sign-off on AFC-578, so there is no mapping to pin yet. The
-- weekly-figures CSV shape per tab lives in the AFC-578 staging document,
-- not in SQL: nothing is imported by this change.

-- ---------------------------------------------------------------------------
-- 87.1  NAMES. Exactly the authoritative six, codes stable.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM areas WHERE code = 'LAG-NORTH') = 1,
    'zones578', 'the seeded area is still Lagos North (LAG-NORTH)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM zones) = 6,
    'zones578', 'still six zones after the correction');

  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z1'), 'Oke Aro Zone',
    'zones578', 'Z1 reads Oke Aro Zone');
  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z2'), 'Sango Zone',
    'zones578', 'Z2 reads Sango Zone');
  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z3'), 'Ifo Zone',
    'zones578', 'Z3 reads Ifo Zone');
  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z4'), 'Itoki Zone',
    'zones578', 'Z4 reads Itoki Zone');
  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z5'), 'Ijoko Zone',
    'zones578', 'Z5 reads Ijoko Zone');
  PERFORM test_support.assert_equals(
    (SELECT name FROM zones WHERE code = 'LAG-NORTH-Z6'), 'Agege Zone',
    'zones578', 'Z6 reads Agege Zone');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM zones
      WHERE code IN ('LAG-NORTH-Z1','LAG-NORTH-Z2','LAG-NORTH-Z3',
                     'LAG-NORTH-Z4','LAG-NORTH-Z5','LAG-NORTH-Z6')) = 6,
    'zones578', 'all six zone codes survive the rename');
  PERFORM test_support.assert_true(
    (SELECT count(DISTINCT sort) FROM zones) = 6,
    'zones578', 'zone sort order untouched (six distinct positions)');
END $$;

-- ---------------------------------------------------------------------------
-- 87.2  DEPENDENTS. Every FK dependent green, no branch moved.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mismatch integer;
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'zones578', 'thirty branches intact (the 30 user-mapped rows)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM bible_study_centres) = 9,
    'zones578', 'nine seeded BSCs intact');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE zone IS NULL) = 0,
    'zones578', 'no branch is zoneless after the rename');

  -- Branch>zone mapping: the rename corrects names; the user-confirmed map
  -- (0028) re-homes LEGUN/MATOGUN/OLOMOWEWE to Z1. Oke-Aro and the three
  -- re-homed samples sit in Z1. The full 30-row map is pinned in suite 93.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone
      WHERE (b.code = 'OKE-ARO' AND z.code = 'LAG-NORTH-Z1')
         OR (b.code IN ('LEGUN', 'MATOGUN', 'OLOMOWEWE') AND z.code = 'LAG-NORTH-Z1')) = 4,
    'zones578', 'Oke-Aro and the three re-homed samples sit in Z1');

  -- Denorm consistency survives the rename (names changed, ids did not).
  SELECT count(*) INTO v_mismatch
    FROM branches b JOIN zones z ON z.id = b.zone
   WHERE b.area IS DISTINCT FROM z.area;
  PERFORM test_support.assert_true(v_mismatch = 0,
    'zones578', 'branch.area still agrees with zone.area on every row');
  SELECT count(*) INTO v_mismatch
    FROM bible_study_centres c JOIN branches b ON b.id = c.parent_branch
   WHERE c.zone IS DISTINCT FROM b.zone;
  PERFORM test_support.assert_true(v_mismatch = 0,
    'zones578', 'bsc.zone still agrees with parent branch zone on every row');

  -- Partition counts after the 0028 seed + BSC carry: Z1 eight branches /
  -- nine BSCs, Z2 four branches / no BSCs.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1')) = 8,
    'zones578', 'Z1 scopes eight branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2')) = 4,
    'zones578', 'Z2 scopes four branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM bible_study_centres WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1')) = 9,
    'zones578', 'Z1 scopes nine BSCs after the carry');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM bible_study_centres WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2')) = 0,
    'zones578', 'Z2 scopes no BSCs after the carry');

  -- WECA workbook branch codes still resolve (one branch identity).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code IN ('OKE-ARO', 'LEGUN', 'MATOGUN', 'OLOMOWEWE')) = 4,
    'zones578', 'the four workbook branch codes still exist as branches');

  -- RESTRICT intact: a zone holding branches is still not deletable.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM zones WHERE code = 'LAG-NORTH-Z1'$q$,
    '23503', 'zones578', 'deleting renamed Z1 is still refused (RESTRICT)');

  -- App ceiling intact: reads yes, DELETE no.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM zones$q$,
    'zones578', 'directus_app can still read zones');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM zones WHERE code = 'LAG-NORTH-Z1'$q$,
    '42501', 'zones578', 'directus_app still has no DELETE on zones');
END $$;

-- ---------------------------------------------------------------------------
-- 87.3  RERUN. 0002 + narrow 0024 + 0022 + 0028 re-applied change nothing.
--        NOTE: 0002 alone resurrects ABULE-EGBA (ON CONFLICT DO NOTHING
--        skips present codes only), so the narrow 0024 + 0028 follow it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql
\i services/directus/schema/migrations/20261020_0024_remove_abule_egba.sql
\i services/directus/schema/migrations/20261020_0022_lagos_north_zones.sql
\i services/directus/schema/migrations/20261020_0028_lagos_north_branches.sql
\i services/directus/schema/migrations/20261020_0029_remove_sango_ota_and_satellite.sql

DO $$
BEGIN
  PERFORM test_support.assert_true((SELECT count(*) FROM zones) = 6,
    'zones578', 'rerun: still six zones');
  PERFORM test_support.assert_true((SELECT count(*) FROM branches) = 30,
    'zones578', 'rerun: still thirty branches');
  PERFORM test_support.assert_equals(
    (SELECT string_agg(name, '|' ORDER BY code) FROM zones),
    'Oke Aro Zone|Sango Zone|Ifo Zone|Itoki Zone|Ijoko Zone|Agege Zone',
    'zones578', 'rerun: 0002 seed does not overwrite the corrected names');
END $$;

-- ---------------------------------------------------------------------------
-- 87.4  ROUND-TRIP. Down restores 0002 names, forward restores authoritative.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261020_0022_lagos_north_zones.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT string_agg(name, '|' ORDER BY code) FROM zones),
    'Oke-Aro Zone|Legun Zone|Matogun Zone|Olomowewe Zone|Abule-Egba Zone|Sango-Ota Zone',
    'zones578', 'down script restores the six 0002 names by code');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'zones578', 'down script deletes no branch row');
END $$;

\i services/directus/schema/migrations/20261020_0022_lagos_north_zones.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT string_agg(name, '|' ORDER BY code) FROM zones),
    'Oke Aro Zone|Sango Zone|Ifo Zone|Itoki Zone|Ijoko Zone|Agege Zone',
    'zones578', 'forward re-applied restores the authoritative names');
END $$;
