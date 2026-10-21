-- rollback/20261020_0024_remove_abule_egba.down.sql
--
-- AFC-582. Rollback for 20261020_0024_remove_abule_egba.sql: re-insert the
-- exact 0002 seed row for ABULE-EGBA (name, code, slug, zone, area, type,
-- label, status, sort). ON CONFLICT (code) DO NOTHING, so reruns are safe
-- and a row the forward file never deleted is left untouched.
-- Owner: migration role (directus_migrator). Never run as directus_app.

INSERT INTO branches (name, code, slug, zone, area, branch_type, type_label, status, sort) VALUES
  ('Abule-Egba', 'ABULE-EGBA', 'abule-egba',
   (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5'),
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'semi_formed', NULL, 'active', 105)
ON CONFLICT (code) DO NOTHING;
