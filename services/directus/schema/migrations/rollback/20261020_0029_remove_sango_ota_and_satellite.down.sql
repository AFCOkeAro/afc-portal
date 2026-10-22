-- rollback/20261020_0029_remove_sango_ota_and_satellite.down.sql
--
-- Rollback for 20261020_0029_remove_sango_ota_and_satellite.sql: re-insert the
-- exact 0002 seed rows for SANGO-OTA and OKE-ARO-SAT-1 (name, code, slug,
-- zone, area, type, label, status, sort). ON CONFLICT (code) DO NOTHING, so
-- reruns are safe and a row the forward file never deleted is left untouched.
-- Owner: migration role (directus_migrator). Never run as directus_app.

INSERT INTO branches (name, code, slug, zone, area, branch_type, type_label, status, sort) VALUES
  ('Sango-Ota', 'SANGO-OTA', 'sango-ota',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z6'),
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'worship_centre', NULL, 'active', 106),
  ('Oke-Aro Satellite', 'OKE-ARO-SAT-1', 'oke-aro-sat-1',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'satellite', NULL, 'active', 107)
ON CONFLICT (code) DO NOTHING;

UPDATE branches SET parent_branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')
 WHERE code = 'OKE-ARO-SAT-1' AND parent_branch IS NULL;
