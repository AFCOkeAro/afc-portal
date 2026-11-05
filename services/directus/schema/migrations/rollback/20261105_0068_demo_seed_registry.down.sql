-- rollback/20261105_0068_demo_seed_registry.down.sql
--
-- Reversal of 20261105_0068_demo_seed_registry.sql (AFC-1086).
--
-- REFUSES while demo_seed_registry holds rows: a registry with entries
-- means demo data is still planted, and dropping the address book first
-- would orphan it beyond the reach of 002_demo_clear.sql. Run the clear
-- script (or the admin clear API), then roll back.
--
-- Drops in dependency order (audit first, registry second), no CASCADE.
-- Owner: migration role (directus_migrator). Never run as directus_app.

DO $$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM demo_seed_registry;
  IF v_left > 0 THEN
    RAISE EXCEPTION
      'demo_seed_registry still holds % row(s): clear the demo data first '
      '(services/directus/seeds/demo/002_demo_clear.sql or the admin clear '
      'API), then roll back. Dropping the address book before the data '
      'would orphan planted rows.',
      v_left
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TABLE IF EXISTS demo_admin_actions;
DROP TABLE IF EXISTS demo_seed_registry;
