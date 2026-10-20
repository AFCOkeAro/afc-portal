-- rollback/20261020_0022_lagos_north_zones.down.sql
--
-- Reversal for 20261020_0022_lagos_north_zones.sql. AFC-578.
--
-- What it destroys, stated plainly: nothing. Both directions are renames by
-- code; no row is created or deleted, no FK is touched, no branch is
-- re-homed. This script restores the six 0002 seed names:
--   LAG-NORTH-Z1 -> 'Oke-Aro Zone', Z2 -> 'Legun Zone',
--   Z3 -> 'Matogun Zone', Z4 -> 'Olomowewe Zone', Z5 -> 'Abule-Egba Zone',
--   Z6 -> 'Sango-Ota Zone'.
-- No refuse guard: a rename rollback cannot strand dependents (dependents
-- key off codes/ids, never off names). Idempotent (IS DISTINCT FROM), and a
-- database the forward file never touched is a silent no-op.
-- Re-apply 20261020_0022 to restore the authoritative names.

UPDATE zones SET name = 'Oke-Aro Zone'    WHERE code = 'LAG-NORTH-Z1' AND name IS DISTINCT FROM 'Oke-Aro Zone';
UPDATE zones SET name = 'Legun Zone'      WHERE code = 'LAG-NORTH-Z2' AND name IS DISTINCT FROM 'Legun Zone';
UPDATE zones SET name = 'Matogun Zone'    WHERE code = 'LAG-NORTH-Z3' AND name IS DISTINCT FROM 'Matogun Zone';
UPDATE zones SET name = 'Olomowewe Zone'  WHERE code = 'LAG-NORTH-Z4' AND name IS DISTINCT FROM 'Olomowewe Zone';
UPDATE zones SET name = 'Abule-Egba Zone' WHERE code = 'LAG-NORTH-Z5' AND name IS DISTINCT FROM 'Abule-Egba Zone';
UPDATE zones SET name = 'Sango-Ota Zone'  WHERE code = 'LAG-NORTH-Z6' AND name IS DISTINCT FROM 'Sango-Ota Zone';
