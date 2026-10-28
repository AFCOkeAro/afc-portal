-- Migration 0041: Directus-runtime grants for directus_app (AFC-768,
-- follow-up to AFC-749).
--
-- Attempting the section-8.3 identity switch showed Directus 11 cannot boot
-- as directus_app: the role holds zero grants on the directus_* system
-- tables (denied on directus_migrations at boot) and staging rolled back to
-- the owner wiring. This file grants exactly the runtime surface Directus
-- needs, explicitly enumerated table by table (no blanket ALL TABLES):
-- full DML over the 29 directus_* system tables plus USAGE/SELECT on their
-- sequences. App-table grants are untouched: the column-scoped model
-- (0013, 0033, 0040) stands, and portal code reaches system state only
-- through the Directus API, which enforces per-user permissions.
-- Each grant is guarded by to_regclass: scratch databases never create
-- Directus system tables (Directus itself creates them at first boot), so
-- the migration is a safe no-op there and effective where they exist.
-- Maintenance note: a Directus major upgrade that ADDS system tables needs
-- this list extended (and the suite-100 pin updated); drift fails loudly
-- on staging-shaped databases.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directus_access', 'directus_activity', 'directus_collections', 'directus_comments', 'directus_dashboards', 'directus_deployment_projects', 'directus_deployment_runs', 'directus_deployments', 'directus_extensions', 'directus_fields', 'directus_files', 'directus_flows', 'directus_folders', 'directus_migrations', 'directus_notifications', 'directus_operations', 'directus_panels', 'directus_permissions', 'directus_policies', 'directus_presets', 'directus_relations', 'directus_revisions', 'directus_roles', 'directus_sessions', 'directus_settings', 'directus_shares', 'directus_translations', 'directus_users', 'directus_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO directus_app', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['directus_fields_id_seq', 'directus_activity_id_seq', 'directus_permissions_id_seq', 'directus_presets_id_seq', 'directus_relations_id_seq', 'directus_revisions_id_seq', 'directus_settings_id_seq', 'directus_notifications_id_seq'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO directus_app', t);
    END IF;
  END LOOP;
END $$;
