-- Migration 0032: denormalise branch/zone onto campaign_steps and
-- campaign_runs so the Directus policies can scope them without relational
-- metadata (directus_relations is empty in this deployment).
--
-- The campaigns list/detail routes read steps and runs by `campaign IN (...)`
-- using the ids already visible to the session, but Directus checks the
-- permission on each collection independently. Without branch/zone on these
-- two tables the policy could not express "own branch" and every read fell
-- through to a 403 that the route maps to pending_migration_0006.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_steps','campaign_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (branch)', t || '_branch_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (zone)', t || '_zone_idx', t);
    EXECUTE format('UPDATE %I c SET branch = p.branch, zone = p.zone FROM campaigns p WHERE c.campaign = p.id AND (c.branch IS NULL OR c.zone IS NULL)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS afc_set_scope ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF campaign ON %I '
      'FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope(%L, %L, %L)',
      t, 'campaign', 'campaigns', '1');
  END LOOP;
END
$$;
