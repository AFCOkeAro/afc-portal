-- Rollback for 0041: revoke exactly the added grants (guarded by
-- to_regclass like the forward file). App-table and pre-existing grants
-- are untouched.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directus_access', 'directus_activity', 'directus_collections', 'directus_comments', 'directus_dashboards', 'directus_deployment_projects', 'directus_deployment_runs', 'directus_deployments', 'directus_extensions', 'directus_fields', 'directus_files', 'directus_flows', 'directus_folders', 'directus_migrations', 'directus_notifications', 'directus_operations', 'directus_panels', 'directus_permissions', 'directus_policies', 'directus_presets', 'directus_relations', 'directus_revisions', 'directus_roles', 'directus_sessions', 'directus_settings', 'directus_shares', 'directus_translations', 'directus_users', 'directus_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM directus_app', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['directus_fields_id_seq', 'directus_activity_id_seq', 'directus_permissions_id_seq', 'directus_presets_id_seq', 'directus_relations_id_seq', 'directus_revisions_id_seq', 'directus_settings_id_seq', 'directus_notifications_id_seq'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE USAGE, SELECT ON SEQUENCE public.%I FROM directus_app', t);
    END IF;
  END LOOP;
END $$;
