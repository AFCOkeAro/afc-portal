-- 20261127_0073_directus11_policy_writer_cutover.sql
--
-- AFC-1247: Directus 11 policy-based version of the G3 writer cutover.
--
-- WHY THIS FILE EXISTS. Migrations 0069/0072 were written for Directus v10,
-- where a permission row binds to `directus_permissions.role`. Directus 11
-- replaced that with `directus_permissions.policy` -> `directus_policies`,
-- with roles linked to policies through `directus_access`. On staging
-- (Directus 11.17.4) `directus_permissions.role` does not exist; 0072 fails
-- with `column p.role does not exist`.
--
-- 0069/0072 now detect the policy column and return, leaving the v10 path
-- untouched for a v10 database. This file performs the same security
-- outcome on v11:
--   * zero public event_registrations permissions (create/read/update/delete)
--   * one non-public `registration_writer` policy, create-only on the 18-field
--     writer allowlist
--   * one `registration_writer` role linked to that policy for the static
--     writer token user
--   * the same server-side consent stamp trigger as 0072
--
-- The writer token itself is NOT created here. The operator creates a user
-- assigned to the `registration_writer` role, mints its static token into
-- `NUXT_DIRECTUS_WRITER_TOKEN` on the host, and never posts the token.
--
-- This file creates no admin access and no public read. The writer policy is
-- app_access=false/admin_access=false. It is a server-held credential only.
--
-- Rerunnable: policy/role/access/permission are matched by stable names and
-- the create row is converged to the exact allowlist.

DO $$
DECLARE
  v_writer_allow text[] := ARRAY[
    'age_group', 'allergies', 'branch',
    'date_of_birth', 'email', 'emergency_contact_name',
    'emergency_contact_phone', 'event', 'guardian_consent',
    'guardian_email', 'guardian_name', 'guardian_phone',
    'idempotency_key', 'medical_notes', 'phone',
    'registrant_first_name', 'registrant_last_name',
    'registration_status'];
  v_writer_policy uuid;
  v_writer_role uuid;
  v_count integer;
  v_public_ids uuid[];
  v_deleted integer;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL
     OR to_regclass('public.directus_policies') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261127_0073: Directus system tables not present. Re-run after Directus boots.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'directus_permissions'
       AND column_name = 'policy'
  ) THEN
    RAISE NOTICE
      'Skipping 20261127_0073: not a Directus 11 policy schema. Use 0069/0072 on v10.';
    RETURN;
  END IF;

  -- 1. Writer policy.
  SELECT count(*) INTO v_count FROM directus_policies WHERE name = 'registration_writer';
  IF v_count = 0 THEN
    INSERT INTO directus_policies
      (id, name, icon, description, enforce_tfa, admin_access, app_access)
    VALUES
      (gen_random_uuid(), 'registration_writer', 'key',
       'AFC-1226 G3 writer policy: create-only event_registrations, server-held token',
       false, false, false);
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0073: % policies named registration_writer. Keep exactly one.',
      v_count USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT id INTO v_writer_policy FROM directus_policies WHERE name = 'registration_writer';

  -- 2. Writer role for the token user.
  SELECT count(*) INTO v_count FROM directus_roles WHERE name = 'registration_writer';
  IF v_count = 0 THEN
    INSERT INTO directus_roles (id, name, icon, description)
    VALUES (gen_random_uuid(), 'registration_writer', 'key',
            'AFC-1226 G3 server-held writer role; no interactive login');
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0073: % roles named registration_writer. Keep exactly one.',
      v_count USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT id INTO v_writer_role FROM directus_roles WHERE name = 'registration_writer';

  -- 3. Role -> policy access.
  SELECT count(*) INTO v_count
    FROM directus_access
   WHERE role = v_writer_role AND policy = v_writer_policy AND "user" IS NULL;
  IF v_count = 0 THEN
    INSERT INTO directus_access (id, role, "user", policy, sort)
    VALUES (gen_random_uuid(), v_writer_role, NULL, v_writer_policy, 1);
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0073: % writer role/policy access rows. Keep exactly one.',
      v_count USING ERRCODE = 'restrict_violation';
  END IF;

  -- 4. Writer create permission, exactly the 18-field allowlist.
  SELECT count(*) INTO v_count
    FROM directus_permissions
   WHERE collection = 'event_registrations'
     AND action = 'create'
     AND policy = v_writer_policy;
  IF v_count = 0 THEN
    INSERT INTO directus_permissions (collection, action, fields, policy)
    VALUES ('event_registrations', 'create', array_to_string(v_writer_allow, ','), v_writer_policy);
  ELSIF v_count = 1 THEN
    UPDATE directus_permissions
       SET fields = array_to_string(v_writer_allow, ',')
     WHERE collection = 'event_registrations'
       AND action = 'create'
       AND policy = v_writer_policy
       AND fields IS DISTINCT FROM array_to_string(v_writer_allow, ',');
  ELSE
    RAISE EXCEPTION
      'refusing 20261127_0073: % writer create permission rows. Keep exactly one.',
      v_count USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM directus_permissions
     WHERE collection = 'event_registrations'
       AND policy = v_writer_policy
       AND action <> 'create'
  ) THEN
    RAISE EXCEPTION
      'refusing 20261127_0073: registration_writer has a non-create event_registrations permission. The writer is create-only.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- 5. Identify every public policy: the anonymous $t:public_label policy,
  -- the named public feed/reader policies, and any policy attached to the
  -- portal-public / Public Reader roles.
  SELECT array_agg(DISTINCT p.id) INTO v_public_ids
    FROM directus_policies p
    LEFT JOIN directus_access a ON a.policy = p.id
    LEFT JOIN directus_roles r ON r.id = a.role
   WHERE p.id <> v_writer_policy
     AND (
       p.name IN ('$t:public_label', 'portal-public-feed', 'afc-public-reader')
       OR lower(coalesce(r.name, '')) IN ('portal-public', 'public reader')
     );

  IF v_public_ids IS NULL THEN
    v_public_ids := ARRAY[]::uuid[];
  END IF;

  -- 6. Remove every public permission on event_registrations. This is
  -- deliberately all actions, not only create: a public read of ticket codes
  -- or child fields is the same PII boundary. The portal reads through the
  -- server token; the public token only reads events.
  DELETE FROM directus_permissions
   WHERE collection = 'event_registrations'
     AND policy = ANY(v_public_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE
    '20261127_0073 applied: writer policy % / role %; removed % public event_registrations permission row(s) across % public policy/policies.',
    v_writer_policy, v_writer_role, v_deleted, coalesce(array_length(v_public_ids, 1), 0);
END
$$;

-- 7. Server-side consent stamp, identical to the v10 0072 trigger.
CREATE OR REPLACE FUNCTION event_registrations_stamp_server_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF NEW.guardian_consent IS TRUE AND NEW.consent_signed_at IS NULL THEN
    NEW.consent_signed_at := now();
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION event_registrations_stamp_server_fields() IS
  'AFC-1226 G3: server-side stamp for writer-path rows. consent_signed_at is server time whenever guardian_consent is true and no value is present; explicit values are kept. source rides its NOT NULL DEFAULT (public_form); it is not a writer-writable column.';

DROP TRIGGER IF EXISTS event_registrations_stamp_server_fields ON event_registrations;

CREATE TRIGGER event_registrations_stamp_server_fields
  BEFORE INSERT ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registrations_stamp_server_fields();
