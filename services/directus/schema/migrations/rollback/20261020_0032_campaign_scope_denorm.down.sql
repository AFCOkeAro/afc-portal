DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_steps','campaign_runs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS afc_set_scope ON %I', t);
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_branch_idx');
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_zone_idx');
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS zone', t);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS branch', t);
  END LOOP;
END
$$;
