-- 20261020_0028_lagos_north_branches.sql
--
-- Branch-seed completion: Lagos North's 30 user-mapped branches (AFC-578,
-- parent AFC-460). Authority: user-supplied 30-row branch>zone>type table
-- (server-verified answers on AFC-578) + CTO sequencing ruling (narrow
-- 0024_remove_abule_egba landed first as commit 5da6740; this broader seed
-- follows under a NEW number and never reuses 0024).
--
-- WHAT THIS FILE DOES (all by CODE — codes stay the identity):
--   1. RE-HOMES three samples per the user-confirmed branch>zone map:
--      LEGUN Z2->Z1, MATOGUN Z3->Z1, OLOMOWEWE Z4->Z1 (the user table places
--      all three under Oke Aro zone). Guarded: refuses if any of the three
--      sits anywhere but its 0002 zone or Z1 (a board edit elsewhere must
--      not be yanked silently). Their BSC zone denorms ride along (denorm
--      must equal the parent zone — the scope-filter invariant).
--   2. CORRECTS two sample types per the user table: LEGUN and OLOMOWEWE
--      were seeded full_fledged/FFC; the user lists both as Semi Formed
--      Church. OKE-ARO (Fully Formed) and MATOGUN (AFWC) already match and
--      are not touched.
--   3. SEEDS the 26 missing branches with the user's zone + type, codes
--      mechanical UPPER-hyphen of the user's names, slugs lowercase, sorts
--      108-133. Pre-checked: any of the 26 codes already present with a
--      different name/zone/type refuses loudly (board edits win over
--      re-seeds); ON CONFLICT (code) DO NOTHING covers identical reruns.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO (stated, per CTO ruling):
--   SANGO-OTA is NOT touched. It is absent from the 30-row list, but the
--   CTO ruled absence is not a removal order without an explicit user
--   order — so it stays exactly as seeded (worship_centre, Z6) alongside
--   the new SANGO branch. ABULE-EGBA is NOT touched either: the landed
--   narrow 0024 owns that removal; re-deleting it here would fork the two
--   migrations' reversibility stories.
--   No BSC rows for the 26 (zone scoping works off the branch FK; seeding
--   invented BSCs would be inventing structure).
--
-- CHOICES, STATED (spec-silent, smallest defensible, named for review):
--   Type mapping: "Fully Formed Church" -> (full_fledged, 'FFC');
--   "Semi Formed Church" -> (semi_formed, NULL) — NULL label follows the
--   removed ABULE-EGBA 0002 precedent (semi_formed carried no label);
--   "Apostolic Faith Worship Centres" -> (afwc, 'AFWC') — follows MATOGUN.
--   "Adejobi" (user's type table) wins over "Adejobi-Elere" (earlier map);
--   code ADEJOBI. The Oke-Aro branch keeps its seeded 'Oke-Aro' spelling
--   (codes are the identity; no branch rename was requested).
--
-- GRANTS: none changed. directus_migrator owns the tables; this file
-- provisions no roles and grants no role-creation or superuser capability
-- (ADR-0002, scripts/migration-privilege-gate.sh).
-- No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0028_lagos_north_branches.down.sql (deletes
-- the 26 guarded-by-references; restores the three zones/types; touches
-- neither sample row).
-- Owner: migration role (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
      FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
     WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Re-home the three samples per the user-confirmed map, carrying their
--    BSC zone denorms. Guarded: each must sit in its 0002 zone or Z1.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM branches b JOIN zones z ON z.id = b.zone
     WHERE (b.code = 'LEGUN' AND z.code NOT IN ('LAG-NORTH-Z2', 'LAG-NORTH-Z1'))
        OR (b.code = 'MATOGUN' AND z.code NOT IN ('LAG-NORTH-Z3', 'LAG-NORTH-Z1'))
        OR (b.code = 'OLOMOWEWE' AND z.code NOT IN ('LAG-NORTH-Z4', 'LAG-NORTH-Z1'))) THEN
    RAISE EXCEPTION
      'refusing to re-home samples: LEGUN/MATOGUN/OLOMOWEWE sit outside both their 0002 zone and Z1. A board edit is in play; reconcile it in a reviewed step, not by overwrite.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

UPDATE branches SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1')
 WHERE code IN ('LEGUN', 'MATOGUN', 'OLOMOWEWE')
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1');

UPDATE bible_study_centres SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1')
 WHERE parent_branch IN (SELECT id FROM branches WHERE code IN ('LEGUN', 'MATOGUN', 'OLOMOWEWE'))
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1');

-- ---------------------------------------------------------------------------
-- 2. Correct the two sample types per the user table. Idempotent guards.
-- ---------------------------------------------------------------------------
UPDATE branches SET branch_type = 'semi_formed', type_label = NULL
 WHERE code = 'LEGUN'
   AND (branch_type IS DISTINCT FROM 'semi_formed' OR type_label IS DISTINCT FROM NULL);
UPDATE branches SET branch_type = 'semi_formed', type_label = NULL
 WHERE code = 'OLOMOWEWE'
   AND (branch_type IS DISTINCT FROM 'semi_formed' OR type_label IS DISTINCT FROM NULL);

-- ---------------------------------------------------------------------------
-- 3. Pre-check: a present-but-different code refuses loudly (board edits win).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(code, ', ') INTO v_bad FROM (
    VALUES
      ('AKUTE', 'Akute', 'LAG-NORTH-Z1', 'full_fledged', 'FFC'),
      ('KOYEMIDUN', 'Koyemidun', 'LAG-NORTH-Z1', 'full_fledged', 'FFC'),
      ('OLAMBE', 'Olambe', 'LAG-NORTH-Z1', 'semi_formed', NULL),
      ('SANGO', 'Sango', 'LAG-NORTH-Z2', 'full_fledged', 'FFC'),
      ('IJU-OTA', 'Iju Ota', 'LAG-NORTH-Z2', 'full_fledged', 'FFC'),
      ('NEW-CITY', 'New City', 'LAG-NORTH-Z2', 'semi_formed', NULL),
      ('DALEMO', 'Dalemo', 'LAG-NORTH-Z2', 'semi_formed', NULL),
      ('IFO', 'Ifo', 'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('COKER', 'Coker', 'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('PAKOTO', 'Pakoto', 'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('AGOSI', 'Agosi', 'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('IBOGUN', 'Ibogun', 'LAG-NORTH-Z3', 'full_fledged', 'FFC'),
      ('ITORI', 'Itori', 'LAG-NORTH-Z3', 'semi_formed', NULL),
      ('ITOKI', 'Itoki', 'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('ABULE-IROKO', 'Abule Iroko', 'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('OKE-OKO', 'Oke Oko', 'LAG-NORTH-Z4', 'full_fledged', 'FFC'),
      ('ADIYAN', 'Adiyan', 'LAG-NORTH-Z4', 'semi_formed', NULL),
      ('ORUDU-AGIRA', 'Orudu Agira', 'LAG-NORTH-Z4', 'afwc', 'AFWC'),
      ('IJOKO', 'Ijoko', 'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('LISA', 'Lisa', 'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('LERIN', 'Lerin', 'LAG-NORTH-Z5', 'full_fledged', 'FFC'),
      ('AGORO', 'Agoro', 'LAG-NORTH-Z5', 'semi_formed', NULL),
      ('AGEGE', 'Agege', 'LAG-NORTH-Z6', 'full_fledged', 'FFC'),
      ('OJOKORO', 'Ojokoro', 'LAG-NORTH-Z6', 'full_fledged', 'FFC'),
      ('ADEJOBI', 'Adejobi', 'LAG-NORTH-Z6', 'afwc', 'AFWC'),
      ('KOLAWOLE', 'Kolawole', 'LAG-NORTH-Z6', 'afwc', 'AFWC')
  ) AS want(code, name, zcode, btype, tlabel)
  WHERE EXISTS (SELECT 1 FROM branches b WHERE b.code = want.code)
    AND NOT EXISTS (
      SELECT 1 FROM branches b
        JOIN zones z ON z.id = b.zone
       WHERE b.code = want.code
         AND b.name = want.name
         AND z.code = want.zcode
         AND b.branch_type = want.btype
         AND b.type_label IS NOT DISTINCT FROM want.tlabel::text);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing to seed branches: existing row(s) differ from the user-mapped seed: %. A present-but-different row is a board edit or a conflicting seed; reconcile it in a reviewed step, not by overwrite.',
      v_bad
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Seed the 26. Rerunnable: ON CONFLICT (code) DO NOTHING after the §3
--    pre-check (identical reruns insert nothing; different rows already
--    refused above).
-- ---------------------------------------------------------------------------
INSERT INTO branches (name, code, slug, zone, area, branch_type, type_label, status, sort) VALUES
  ('Akute', 'AKUTE', 'akute',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 108),
  ('Koyemidun', 'KOYEMIDUN', 'koyemidun',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 109),
  ('Olambe', 'OLAMBE', 'olambe',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 110),
  ('Sango', 'SANGO', 'sango',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 111),
  ('Iju Ota', 'IJU-OTA', 'iju-ota',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 112),
  ('New City', 'NEW-CITY', 'new-city',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 113),
  ('Dalemo', 'DALEMO', 'dalemo',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 114),
  ('Ifo', 'IFO', 'ifo',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 115),
  ('Coker', 'COKER', 'coker',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 116),
  ('Pakoto', 'PAKOTO', 'pakoto',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 117),
  ('Agosi', 'AGOSI', 'agosi',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 118),
  ('Ibogun', 'IBOGUN', 'ibogun',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 119),
  ('Itori', 'ITORI', 'itori',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 120),
  ('Itoki', 'ITOKI', 'itoki',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 121),
  ('Abule Iroko', 'ABULE-IROKO', 'abule-iroko',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 122),
  ('Oke Oko', 'OKE-OKO', 'oke-oko',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 123),
  ('Adiyan', 'ADIYAN', 'adiyan',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 124),
  ('Orudu Agira', 'ORUDU-AGIRA', 'orudu-agira',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'afwc', 'AFWC', 'active', 125),
  ('Ijoko', 'IJOKO', 'ijoko',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 126),
  ('Lisa', 'LISA', 'lisa',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 127),
  ('Lerin', 'LERIN', 'lerin',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 128),
  ('Agoro', 'AGORO', 'agoro',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'semi_formed', NULL, 'active', 129),
  ('Agege', 'AGEGE', 'agege',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 130),
  ('Ojokoro', 'OJOKORO', 'ojokoro',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'full_fledged', 'FFC', 'active', 131),
  ('Adejobi', 'ADEJOBI', 'adejobi',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'afwc', 'AFWC', 'active', 132),
  ('Kolawole', 'KOLAWOLE', 'kolawole',
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'), (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
    'afwc', 'AFWC', 'active', 133)
ON CONFLICT (code) DO NOTHING;
