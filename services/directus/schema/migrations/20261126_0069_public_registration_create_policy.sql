-- 20261126_0069_public_registration_create_policy.sql
--
-- Public registration create-only Directus POLICY (AFC-1254 rework of the
-- AFC-1222 file at this same number, operator finding 2026-11-27, human,
-- authoritative).
--
-- WHY THIS FILE EXISTS IN THIS FORM. The AFC-1222 file matched the public
-- grant by `directus_permissions.role IS NULL` (the Directus v10 public
-- convention). Staging Directus is 11.17.4: `directus_permissions` carries a
-- `policy uuid NOT NULL` column and NO `role` column; the public grant is
-- policy-scoped (portal-public-feed / afc-public-reader), not role-NULL.
-- The v10 file's version guard only checked table existence,
-- `directus_roles` exists in v11, so it proceeded and failed on
-- `column p.role does not exist` — the operator's rolled-back-transaction
-- result. That v10 file never deployed anywhere. The CTO ratifies
-- v11-policy as the target (the repo pins `directus/directus:11`); this
-- rewrite replaces it at the same number. Do not silently pick a target
-- version — v11-policy is the ratified one, and this file refuses a v10
-- shape instead of guessing.
--
-- WHAT THIS FILE DOES
--   Resolves the PUBLIC policy set — the policies reachable from anonymous
--   Directus access (`directus_access` with role AND "user" NULL), plus, when
--   present, the policy used by the portal-public service user
--   (`portal-public@staging.local`, directly or through its role) — and sets
--   exactly one public event_registrations/create permission row to exactly
--   the 18-field allowlist below: the 16 PUBLIC_REGISTRATION_FIELDS from
--   packages/shared/src/schemas/registration.ts PLUS the server-stamped
--   `source` and `consent_signed_at`. Matched by (policy-in-public-set,
--   collection, action), never by hardcoded perm or policy id, so it ports
--   across environments.
--
-- RESOLUTION CHOICE (spec silent, smallest defensible, named for review):
-- anonymous-access policies are authoritative; the service-user linkage is a
-- fallback for environments where the public reads ride a service token
-- rather than true anonymous access. On an environment without that user the
-- anonymous set alone governs; a wrong set fails safe (zero hits is a loud
-- NOTICE, multi-row is a refusal — never a widened grant).
--
-- THE ALLOWLIST (18 fields, sorted a-z). Canonical source: the 16
-- PUBLIC_REGISTRATION_FIELDS plus the two server-stamped columns the route
-- writes and the client cannot send.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No read/update/delete for the public policies on event_registrations,
--   ever. If any public-set row on event_registrations carries an action
--   other than create, this file RAISEs (restrict_violation) instead of
--   proceeding: public read on child PII is a shipping blocker, not a
--   migration detail. (data-model §9: the public policy has no read on any
--   non-public collection; the matrix grants public read on events/public
--   only. The S9-vs-matrix wording conflict is resolved in the register
--   route header; the S9 sentence itself needs a CTO-ratified edit.)
--   No PII beyond what the registrant supplies: the allowlist carries no
--   ticket_code, registration_status, amount_*, payment_*, person or
--   group_code — those are Flow/staff columns.
--   No 404-never-403 change: collection, action and policy bindings are
--   untouched; only `fields` is written.
--   No row creation: if no public create row exists, this file NOTICEes the
--   operator step and changes nothing. A migration must never invent an
--   access grant to make itself pass (0064 precedent).
--   No multi-row choice: more than one public create candidate RAISEs
--   (restrict_violation) rather than widening an ambiguous set.
--   No down script (0064 precedent): permission state is environment state;
--   reversal is a new forward migration, not a silent narrowing that could
--   close the live public surface on rollback.
--
-- GRANTS / ROLES. None. This file UPDATEs Directus system-table content; it
-- provisions no roles, no policies, no access rows, and grants no
-- role-creation or superuser capability.
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002 (scripts/migration-privilege-gate.sh).
--
-- ---------------------------------------------------------------------------
-- Guarded skip (0003 pattern): on a database where Directus never booted
-- there are no Directus system tables and nothing to update. The skip is
-- loud (NOTICE) so a deploy log shows it rather than hiding it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_allow text[] := ARRAY[
    'age_group', 'allergies', 'branch', 'consent_signed_at',
    'date_of_birth', 'email', 'emergency_contact_name',
    'emergency_contact_phone', 'event', 'guardian_consent',
    'guardian_email', 'guardian_name', 'guardian_phone',
    'medical_notes', 'phone', 'registrant_first_name',
    'registrant_last_name', 'source'];
  v_public_policies uuid[] := '{}';
  v_has_policy integer := 0;
  v_has_role integer := 0;
  v_create_hits integer := 0;
  v_allow_hits integer := 0;
  v_other_actions integer := 0;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL
     OR to_regclass('public.directus_policies') IS NULL
     OR to_regclass('public.directus_access') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261126_0069: Directus v11 system tables not present (Directus never booted on this database). Re-run after the Directus system schema exists.';
    RETURN;
  END IF;

  -- Target-shape guard (AFC-1254): this file speaks the v11 policy model.
  -- A v10 database (role column present) is the wrong target, not a
  -- variant to accommodate — refuse, do not guess.
  SELECT count(*) INTO v_has_policy
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'directus_permissions'
     AND column_name = 'policy';
  SELECT count(*) INTO v_has_role
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'directus_permissions'
     AND column_name = 'role';

  IF v_has_role > 0 THEN
    RAISE EXCEPTION
      'refusing 20261126_0069: directus_permissions still carries the v10 role column. This file targets the v11 policy model (CTO-ratified; repo pins directus/directus:11). Migrate Directus to v11 first, then re-run.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_has_policy = 0 THEN
    RAISE EXCEPTION
      'refusing 20261126_0069: directus_permissions has neither a policy nor a role column — an unknown permission shape. Refusing to edit an access grant blindly.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Resolve the public policy set: anonymous access first (authoritative),
  -- then the portal-public service user linkage when that user exists.
  SELECT COALESCE(array_agg(DISTINCT a.policy), '{}') INTO v_public_policies
    FROM directus_access a
   WHERE a.role IS NULL AND a."user" IS NULL;

  IF to_regclass('public.directus_users') IS NOT NULL THEN
    SELECT v_public_policies
         || COALESCE((SELECT array_agg(DISTINCT a.policy)
                        FROM directus_access a
                        JOIN directus_users u ON u.id = a."user"
                       WHERE u.email = 'portal-public@staging.local'), '{}')
         || COALESCE((SELECT array_agg(DISTINCT a.policy)
                        FROM directus_access a
                       WHERE a.role IN (SELECT u.role FROM directus_users u
                                         WHERE u.email = 'portal-public@staging.local'
                                           AND u.role IS NOT NULL)), '{}')
      INTO v_public_policies;
  END IF;

  SELECT count(*) INTO v_other_actions
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action <> 'create'
     AND p.policy = ANY(v_public_policies);

  IF v_other_actions > 0 THEN
    RAISE EXCEPTION
      'refusing 20261126_0069: % public-policy permission row(s) on event_registrations carry a non-create action. The public policy must be create-only on registrations (child PII); remove the read/update/delete grant in a reviewed snapshot, then re-run.',
      v_other_actions
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_create_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.policy = ANY(v_public_policies);

  SELECT count(*) INTO v_allow_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.policy = ANY(v_public_policies)
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_allow;

  IF v_allow_hits > 0 AND v_create_hits = v_allow_hits THEN
    RAISE NOTICE
      '20261126_0069 already applied: the public event_registrations/create permission carries the 18-field allowlist. No change.';
    RETURN;
  END IF;

  IF v_create_hits = 0 THEN
    RAISE NOTICE
      '20261126_0069 not applied: no public-policy event_registrations/create permission exists. As the Directus operator, grant the PUBLIC policy create on event_registrations with exactly these fields: %. Then re-run this migration.',
      array_to_string(v_allow, ',');
    RETURN;
  END IF;

  IF v_create_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261126_0069: % public event_registrations/create rows. Widening an ambiguous set would grant blindly. As the Directus operator, keep exactly one public create permission and re-run.',
      v_create_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE directus_permissions p
     SET fields = array_to_string(v_allow, ',')
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.policy = ANY(v_public_policies)
     AND NOT ((SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_allow);

  RAISE NOTICE
    '20261126_0069 applied: public event_registrations/create permission set to the 18-field allowlist (16 public fields + source + consent_signed_at). No read/update/delete, no PII beyond registrant-supplied columns, 404-never-403 preserved.';
END
$$;
