-- tests/db/93_lagos_north_branches.sql
--
-- AFC-578 (parent AFC-460). THE USER-MAPPED BRANCH TABLE CONTRACT, second
-- half: the 30-row branch>zone>type table over the landed narrow removal.
--
-- The user supplied the authoritative 30-row branch>zone>type table
-- (server-verified answers on AFC-578); the CTO sequencing ruling landed
-- the narrow ABULE-EGBA removal first (0024_remove_abule_egba, commit
-- 5da6740) and ordered this broader seed under a new number (0028), with
-- the 30 user-mapped rows only. Migration 0028 re-homes
-- LEGUN/MATOGUN/OLOMOWEWE + BSC denorms to Z1, fixes LEGUN/OLOMOWEWE to
-- semi_formed/NULL, and seeds the 26 missing
-- rows. This suite asserts the database half of that promise:
--
--   93.1  map         -- all 30 user names resolve with the mapped zone and
--                         type; ABULE-EGBA absent (narrow 0024's pin);
--                         30 rows; per-zone partition 7/4/6/5/4/4.
--   93.2  resurrect   -- re-applying 0002 ALONE brings ABULE-EGBA back (ON
--                         CONFLICT DO NOTHING skips present codes only);
--                         0024_remove deletes it again; 0028 re-applied is a
--                         no-op. The sequence is idempotent; no single file is.
--   93.3  types       -- the vocabulary holds: 18 full_fledged (all FFC),
--                         8 semi_formed (no label), 4 afwc (all AFWC).
--   93.4  guards      -- a duplicate code is still rejected; a populated
--                         zone still cannot be deleted (RESTRICT).
--
-- NAME VARIANCE, STATED: the user table spells the flagship branch "Oke
-- Aro" but the 0002 seed row (code OKE-ARO, referenced by finance/route
-- fixtures) is named 'Oke-Aro'. This suite pins the SEEDED spelling: the
-- migration deliberately does not rename branch rows (codes are the
-- identity, and no rename was requested). A branch display-name pass is a
-- separate reviewed change if the board wants it.
--
-- What this suite does NOT assert (stated, not missing): BSC coverage for
-- the 26 (0028 deliberately creates none), the weekly-figures CSV build
-- (blessings parked per CTO decision; attendance staging documented on
-- AFC-578; 2025/26 tabs ETA next week), and the HTTP half of branch
-- scoping (route layer, covered elsewhere).

-- ---------------------------------------------------------------------------
-- 93.1  MAP. All 30 user names resolve with the mapped zone and type.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mismatch integer;
BEGIN
  WITH want(code, name, zcode, btype, tlabel) AS (
    VALUES
      ('OKE-ARO',     'Oke-Aro',     'LAG-NORTH-Z1', 'full_fledged', 'FFC'),
      ('AKUTE',       'Akute',       'LAG-NORTH-Z1', 'full_fledged', 'FFC'),
      ('KOYEMIDUN',   'Koyemidun',   'LAG-NORTH-Z1', 'full_fledged', 'FFC'),
      ('OLAMBE',      'Olambe',      'LAG-NORTH-Z1', 'semi_formed',  NULL),
      ('LEGUN',       'Legun',       'LAG-NORTH-Z1', 'semi_formed',  NULL),
      ('OLOMOWEWE',   'Olomowewe',   'LAG-NORTH-Z1', 'semi_formed',  NULL),
      ('MATOGUN',     'Matogun',     'LAG-NORTH-Z1', 'afwc',         'AFWC'),
      ('SANGO',       'Sango',       'LAG-NORTH-Z2', 'full_fledged', 'FFC'),
      ('IJU-OTA',     'Iju Ota',     'LAG-NORTH-Z2', 'full_fledged', 'FFC'),
      ('NEW-CITY',    'New City',    'LAG-NORTH-Z2', 'semi_formed',  NULL),
      ('DALEMO',      'Dalemo',      'LAG-NORTH-Z2', 'semi_formed',  NULL),
      ('IFO',         'Ifo',         'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('COKER',       'Coker',       'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('PAKOTO',      'Pakoto',      'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('AGOSI',       'Agosi',       'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('IBOGUN',      'Ibogun',      'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('ITORI',       'Itori',       'LAG-NORTH-Z3', 'semi_formed',  NULL),
      ('ITOKI',       'Itoki',       'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('ABULE-IROKO', 'Abule Iroko', 'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('OKE-OKO',     'Oke Oko',     'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('ADIYAN',      'Adiyan',      'LAG-NORTH-Z4', 'semi_formed',  NULL),
      ('ORUDU-AGIRA', 'Orudu Agira', 'LAG-NORTH-Z4', 'afwc',         'AFWC'),
      ('IJOKO',       'Ijoko',       'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('LISA',        'Lisa',        'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('LERIN',       'Lerin',       'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('AGORO',       'Agoro',       'LAG-NORTH-Z5', 'semi_formed',  NULL),
      ('AGEGE',       'Agege',       'LAG-NORTH-Z6', 'full_fledged', 'FFC'),
      ('OJOKORO',     'Ojokoro',     'LAG-NORTH-Z6', 'full_fledged', 'FFC'),
      ('ADEJOBI',     'Adejobi',     'LAG-NORTH-Z6', 'afwc',         'AFWC'),
      ('KOLAWOLE',    'Kolawole',    'LAG-NORTH-Z6', 'afwc',         'AFWC')
  )
  SELECT count(*) INTO v_mismatch
    FROM want
    LEFT JOIN branches b ON b.code = want.code
    LEFT JOIN zones z ON z.id = b.zone
   WHERE b.id IS NULL
      OR b.name IS DISTINCT FROM want.name
      OR z.code IS DISTINCT FROM want.zcode
      OR b.branch_type IS DISTINCT FROM want.btype
      OR b.type_label IS DISTINCT FROM want.tlabel;
  PERFORM test_support.assert_true(v_mismatch = 0,
    'branchmap', 'all 30 user-mapped branches resolve with the mapped zone and type');

  -- ABULE-EGBA stays gone (narrow 0024's pin, restated here so this suite
  -- fails if any re-apply resurrects it without the narrow re-apply).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code IN ('ABULE-EGBA')) = 0,
    'branchmap', 'Abule-Egba stays removed');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'branchmap', 'thirty branch rows (the 30 user-mapped rows)');

  -- Per-zone partition after the seed: Z1:7 Z2:4 Z3:6 Z4:5 Z5:4 Z6:4.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z1') = 7,
    'branchmap', 'Z1 (Oke Aro) scopes seven branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z2') = 4,
    'branchmap', 'Z2 (Sango) scopes four branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z3') = 6,
    'branchmap', 'Z3 (Ifo) scopes six branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z4') = 5,
    'branchmap', 'Z4 (Itoki) scopes five branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z5') = 4,
    'branchmap', 'Z5 (Ijoko) scopes four branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches b JOIN zones z ON z.id = b.zone WHERE z.code = 'LAG-NORTH-Z6') = 4,
    'branchmap', 'Z6 (Agege) scopes four branches');
END $$;

-- ---------------------------------------------------------------------------
-- 93.2  RESURRECT. 0002 alone brings ABULE-EGBA back; the narrow 0024
--         removes it; 0028 is a no-op; 0029 removes the two non-branch
--         rows that 0002 also resurrects.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'ABULE-EGBA') = 1,
    'branchmap', '0002 re-applied resurrects the removed sample');
END $$;

\i services/directus/schema/migrations/20261020_0024_remove_abule_egba.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'ABULE-EGBA') = 0,
    'branchmap', 'narrow 0024 re-applied removes it again');
END $$;

\i services/directus/schema/migrations/20261020_0028_lagos_north_branches.sql
\i services/directus/schema/migrations/20261020_0029_remove_sango_ota_and_satellite.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'branchmap', '0029 re-applied leaves thirty rows');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code IN ('ABULE-EGBA')) = 0,
    'branchmap', 'round-trip keeps Abule-Egba removed');
END $$;

-- ---------------------------------------------------------------------------
-- 93.3  TYPES. The vocabulary holds across the 30 rows.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE branch_type = 'full_fledged') = 18,
    'branchmap', 'eighteen fully-formed branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE branch_type = 'semi_formed') = 8,
    'branchmap', 'eight semi-formed branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE branch_type = 'afwc') = 4,
    'branchmap', 'four worship-centre branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE type_label = 'FFC' AND branch_type <> 'full_fledged') = 0,
    'branchmap', 'every FFC-labelled branch is full_fledged');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE type_label = 'AFWC' AND branch_type <> 'afwc') = 0,
    'branchmap', 'every AFWC-labelled branch is afwc');
END $$;

-- ---------------------------------------------------------------------------
-- 93.4  GUARDS. Codes stay unique; a populated zone still cannot be deleted.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO branches (name, code, zone) VALUES ('Duplicate', 'IFO', (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'))$q$,
    '23505', 'branchmap', 'a duplicate new-branch code is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM zones WHERE code = 'LAG-NORTH-Z5'$q$,
    '23503', 'branchmap', 'deleting Z5 (four branches) is refused (RESTRICT)');
END $$;
