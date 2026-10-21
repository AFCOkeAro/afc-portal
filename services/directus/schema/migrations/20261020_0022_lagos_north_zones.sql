-- 20261020_0022_lagos_north_zones.sql
--
-- Corrective zone rename: Lagos North zones to the authoritative six (AFC-578,
-- parent AFC-460). Spec authority: user correction 2026-10-20 with source
-- sheet https://docs.google.com/spreadsheets/d/1NFJoiOKUx73Ga2aod89-T5JHSlw-NwSI7dvUwHULpZw
-- (link-shared, first tab fetched read-only by the CTO):
-- Area Lagos North > 6 zones (Oke Aro, Sango, Ifo, Itoki, Ijoko, Agege).
--
-- WHAT THIS FILE DOES
--   Renames the six zone rows seeded by 20261020_0002_hierarchy.sql §12 by
--   CODE (the identity; branches, BSCs, conference/AVS centres, WECA suite
--   branch codes and role grants all key off codes/FKs, never off names --
--   verified by grep: no other migration, policy, or route matches a zone
--   name string):
--     LAG-NORTH-Z1  'Oke-Aro Zone'    -> 'Oke Aro Zone'
--     LAG-NORTH-Z2  'Legun Zone'      -> 'Sango Zone'
--     LAG-NORTH-Z3  'Matogun Zone'    -> 'Ifo Zone'
--     LAG-NORTH-Z4  'Olomowewe Zone'  -> 'Itoki Zone'
--     LAG-NORTH-Z5  'Abule-Egba Zone' -> 'Ijoko Zone'
--     LAG-NORTH-Z6  'Sango-Ota Zone'  -> 'Agege Zone'
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No code changes (a recode would orphan FKs; a rename is reversible, a
--   recode is not). No branch re-homing: seeded sample branches stay where
--   0002 put them until the user confirms the branch>zone mapping on
--   AFC-578 -- moving a branch without sign-off would invent structure the
--   user has not ratified. No BSC/location renames: BSC rows and their
--   free-text `location` values keep their sampled names; they are scoped by
--   zone FK, not by name match. No sort/status changes.
--
-- CHOICE, STATED (naming convention): the authoritative list gives bare place
-- names ("Oke Aro", no hyphen); this file appends the existing " Zone"
-- suffix so the six rows keep the convention 0002 seeded
-- ('<Place> Zone'). "Oke Aro" keeps the sheet's space (not 0002's hyphen):
-- display names are labels, codes are the identity.
--
-- IDEMPOTENCY: each UPDATE is guarded by IS DISTINCT FROM, so reruns change
-- nothing. A database where 0002 never seeded is a no-op (zero rows match),
-- not a failure: the seed owns creation, this file owns correction.
--
-- GRANTS: none changed. Renaming rows already visible to directus_app needs
-- no new privilege; this file provisions no roles and grants no
-- role-creation or superuser capability (ADR-0002,
-- scripts/migration-privilege-gate.sh).
-- No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0022_lagos_north_zones.down.sql (renames the
-- six rows back to the 0002 names by code; non-destructive, no refuse
-- guard -- nothing is deleted in either direction).
-- Owner: migration role (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
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
-- 1. Rename by code. Codes are the identity; names are labels.
-- ---------------------------------------------------------------------------
UPDATE zones SET name = 'Oke Aro Zone' WHERE code = 'LAG-NORTH-Z1' AND name IS DISTINCT FROM 'Oke Aro Zone';
UPDATE zones SET name = 'Sango Zone'   WHERE code = 'LAG-NORTH-Z2' AND name IS DISTINCT FROM 'Sango Zone';
UPDATE zones SET name = 'Ifo Zone'     WHERE code = 'LAG-NORTH-Z3' AND name IS DISTINCT FROM 'Ifo Zone';
UPDATE zones SET name = 'Itoki Zone'   WHERE code = 'LAG-NORTH-Z4' AND name IS DISTINCT FROM 'Itoki Zone';
UPDATE zones SET name = 'Ijoko Zone'   WHERE code = 'LAG-NORTH-Z5' AND name IS DISTINCT FROM 'Ijoko Zone';
UPDATE zones SET name = 'Agege Zone'   WHERE code = 'LAG-NORTH-Z6' AND name IS DISTINCT FROM 'Agege Zone';
