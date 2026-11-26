-- 20261127_0072_revoke_public_create_writer_role.sql
--
-- AFC-1226 G3 (high, CTO decision (a)): revoke the public create grant and
-- converge the server-held writer grant.
--
-- ROOT CAUSE. Migration 0069 sets the PUBLIC (role-NULL) create permission
-- on event_registrations to an 18-field allowlist. That allowlist is exact,
-- but the grant itself is the bypass: anyone on the internet can POST the
-- collection directly through Directus, skipping the portal's
-- consent/age/window/dedupe/Turnstile/rate-limit layers. Data-layer
-- enforcement of all of those (option b) is a larger, harder-to-prove
-- surface; a server-held writer role (option a) closes the bypass in one
-- move and keeps the portal as system of record per ADR adr-wp-build.
--
-- TARGET STATE
--   * Zero role-NULL rows on event_registrations: a direct anonymous POST to
--     Directus 403s at the permission layer, whatever it carries — including
--     a minor without consent.
--   * Exactly one `registration_writer` (Directus role, matched BY NAME)
--     create row carrying exactly the 18-field allowlist below: the 16
--     PUBLIC_REGISTRATION_FIELDS plus `registration_status` (the proxy
--     assigns pending/waitlisted server-side; the client form has no such
--     key) plus `idempotency_key` (stamped by the route since 0070 exists).
--     WITHOUT `source` and WITHOUT `consent_signed_at`: those two are
--     stamped server-side — `source` rides its column DEFAULT
--     ('public_form'), `consent_signed_at` is stamped by the trigger in §5
--     below — so a writer-token caller cannot masquerade a staff walk-in or
--     forge consent time.
--   * The writer role is create-only on this collection, like the public
--     role was: any non-create writer row refuses (restrict_violation)
--     instead of proceeding.
--
-- SEQUENCING (fail-closed, AFC-1230 F2). The public grant is revoked only
-- AFTER the writer replacement is verified in place. If the
-- `registration_writer` Directus role does not exist yet, this file RAISES
-- (restrict_violation) instead of exiting 0: a NOTICE+RETURN with the
-- role-NULL create row untouched is a false-green deploy — the G3 bypass
-- persists behind a log line. The operator provisions the role (no
-- read/update/delete, app access minimal), its create permission row (via
-- the Directus UI/snapshot so version-specific columns are filled), and the
-- static token into NUXT_DIRECTUS_WRITER_TOKEN, then re-runs. The
-- tables-absent NOTICE+RETURN below stays: on a database where Directus
-- never booted there is no surface to close, so skipping is correct.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No row creation. If the writer create row is missing, this file RAISES
--   (AFC-1230 F2, fail-closed) and changes nothing — the deploy fails loud
--   instead of exiting 0 with the G3 bypass intact. The operator creates the
--   row with exactly the allowlist below; this file converges an existing
--   row to it and refuses ambiguity (0069 precedent: a migration never
--   invents an access grant to make itself pass).
--   No role lookup by id: Directus role UUIDs differ per environment, so
--   the role is matched by its stable NAME. More than one role with the
--   name refuses rather than widening an ambiguous set.
--   No non-create narrowing: a public or writer read/update/delete row on
--   event_registrations is a shipping blocker (child PII), not a migration
--   detail — this file RAISEs instead of proceeding.
--   No down script (0064 precedent): permission state is environment state;
--   reversal is a new forward migration, not a silent narrowing that could
--   close or reopen the live public surface on rollback.
--
-- GRANTS / ROLES. None. This file UPDATEs/DELETEs Directus system-table
-- content; it provisions no roles and grants no role-creation or superuser
-- capability. Owner: migration role (directus_migrator). Never run as
-- directus_app. Role hygiene per ADR-0002
-- (scripts/migration-privilege-gate.sh).
--
-- ---------------------------------------------------------------------------
-- Guarded skip (0003 pattern): on a database where Directus never booted
-- there are no Directus system tables and nothing to update. The skip is
-- loud (NOTICE) so a deploy log shows it rather than hiding it.
-- ---------------------------------------------------------------------------
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
  v_writer_id uuid;
  v_writer_name_hits integer := 0;
  v_public_other integer := 0;
  v_public_create_hits integer := 0;
  v_writer_other integer := 0;
  v_writer_create_hits integer := 0;
  v_writer_allow_hits integer := 0;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL
     OR to_regclass('public.directus_roles') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261127_0072: Directus system tables not present (Directus never booted on this database). Re-run after the Directus system schema exists.';
    RETURN;
  END IF;

  -- 1. Create-only is the invariant for BOTH identities. A non-create row
  --    for either is a shipping blocker, not a migration detail.
  SELECT count(*) INTO v_public_other
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action <> 'create'
     AND p.role IS NULL;

  IF v_public_other > 0 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: % public (role-NULL) permission row(s) on event_registrations carry a non-create action. The public identity must hold no access at all on registrations (child PII); remove the row(s) in a reviewed snapshot, then re-run.',
      v_public_other
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- 2. The replacement must exist before the legacy grant is touched.
  SELECT count(*) INTO v_writer_name_hits
    FROM directus_roles r
   WHERE r.name = 'registration_writer';

  IF v_writer_name_hits = 0 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: no Directus role named registration_writer. As the Directus operator, create the role (no read/update/delete on event_registrations, minimal app access), grant it create on event_registrations with exactly these fields: %, mint its static token into NUXT_DIRECTUS_WRITER_TOKEN, then re-run this migration. The public grant is left untouched until the replacement exists, and the deploy fails here instead of exiting 0 with the G3 bypass intact (AFC-1230 F2).',
      array_to_string(v_writer_allow, ',')
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_writer_name_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: % Directus roles named registration_writer. Widening an ambiguous set would grant blindly. Keep exactly one registration_writer role and re-run.',
      v_writer_name_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT r.id INTO v_writer_id
    FROM directus_roles r
   WHERE r.name = 'registration_writer';

  SELECT count(*) INTO v_writer_other
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action <> 'create'
     AND p.role = v_writer_id;

  IF v_writer_other > 0 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: % registration_writer permission row(s) on event_registrations carry a non-create action. The writer is create-only (the replay/visibility reads ride the server token); remove the row(s) in a reviewed snapshot, then re-run.',
      v_writer_other
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- 3. Converge the writer create row to exactly the allowlist.
  SELECT count(*) INTO v_writer_create_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.role = v_writer_id;

  SELECT count(*) INTO v_writer_allow_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.role = v_writer_id
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_writer_allow;

  IF v_writer_create_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: % registration_writer event_registrations/create rows. Widening an ambiguous set would grant blindly. Keep exactly one writer create permission and re-run.',
      v_writer_create_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_writer_create_hits = 0 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: the registration_writer role has no event_registrations/create permission. As the Directus operator, grant it create with exactly these fields: %. Then re-run this migration. The public grant is left untouched until the replacement exists, and the deploy fails here instead of exiting 0 with the G3 bypass intact (AFC-1230 F2).',
      array_to_string(v_writer_allow, ',')
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_writer_allow_hits = 0 THEN
    UPDATE directus_permissions p
       SET fields = array_to_string(v_writer_allow, ',')
     WHERE p.collection = 'event_registrations'
       AND p.action = 'create'
       AND p.role = v_writer_id;

    RAISE NOTICE
      '20261127_0072: registration_writer event_registrations/create permission converged to the 18-field writer allowlist (16 public fields + registration_status + idempotency_key; no source, no consent_signed_at).';
  ELSE
    RAISE NOTICE
      '20261127_0072: registration_writer event_registrations/create permission already carries the writer allowlist. No change.';
  END IF;

  -- 4. Only now revoke the legacy public grant. Exactly one row: delete it
  --    (a direct anonymous POST then 403s at the permission layer). Zero:
  --    already revoked. More than one: refuse, never guess.
  SELECT count(*) INTO v_public_create_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.role IS NULL;

  IF v_public_create_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261127_0072: % public event_registrations/create rows. Revoking an ambiguous set blindly could close a grant this file did not review. Keep exactly one public create permission (or none) and re-run.',
      v_public_create_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_public_create_hits = 1 THEN
    DELETE FROM directus_permissions p
     WHERE p.collection = 'event_registrations'
       AND p.action = 'create'
       AND p.role IS NULL;

    RAISE NOTICE
      '20261127_0072 applied: public (role-NULL) event_registrations/create permission revoked. Direct anonymous writes to the collection now fail closed (403) at the permission layer; the only write path is the portal proxy through registration_writer.';
  ELSE
    RAISE NOTICE
      '20261127_0072: no public event_registrations/create permission remains. Already revoked.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Server-side stamping of consent_signed_at (G3, CTO decision).
--
-- The writer grant carries no `source` and no `consent_signed_at`, and the
-- route sends neither. `source` needs no trigger: the column is NOT NULL
-- with DEFAULT 'public_form', so an omitted value stamps itself and an
-- explicit NULL fails closed at the constraint. `consent_signed_at` has no
-- default, so this BEFORE INSERT trigger stamps server time whenever the
-- registrant consented and no value is present. An explicit value (staff
-- corrections, backfills) is kept, never overwritten; an unconsented row
-- keeps NULL, which the route already refuses for minors before writing.
--
-- Plain trigger function, no table reads: there is nothing here that needs
-- the owner's rights, so no SECURITY DEFINER (contrast 0071, where the
-- count must survive a read-less caller). Owner: directus_migrator.
-- ---------------------------------------------------------------------------
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
