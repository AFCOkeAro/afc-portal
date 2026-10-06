-- 20261006_0003_incidents_awareness_field_policy.sql
--
-- Second layer: Directus field-level permissions. AFC-166 section 4.
--
-- Directus permissions are allow-lists, so "exclude awareness_at" means the
-- column is not named in the fields array of any create/update policy. This
-- migration strips it from every one of them, including the super admin
-- policy, so that no Studio form or REST payload can carry the column.
--
-- THIS IS NOT THE CONTROL. If someone widens a policy here, or a Flow uses
-- `exec`, or someone opens psql as directus_app, this file changes nothing.
-- 20261006_0002_incidents_guard_awareness() is what holds. This file exists so
-- that the *usual* paths never even offer the field.
--
-- Runs inside the Directus stack, where directus_permissions exists. Guarded so
-- the standalone database tests can apply the same files without a Directus
-- schema; the skip is loud (NOTICE) and CI asserts the effect separately.

DO $$
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261006_0003: directus_permissions not present (not a Directus database).';
    RETURN;
  END IF;

  UPDATE directus_permissions p
     SET fields = (
           SELECT COALESCE(array_agg(f ORDER BY f), '{}'::text[])
             FROM unnest(p.fields) AS f
            WHERE f NOT IN ('awareness_at', 'awareness_at_source')
         )
   WHERE p.collection = 'incidents'
     AND p.action IN ('create', 'update')
     AND (p.fields && ARRAY['awareness_at', 'awareness_at_source']::text[]);

  RAISE NOTICE 'Stripped awareness_at from Directus create/update field policies on incidents.';
END
$$;