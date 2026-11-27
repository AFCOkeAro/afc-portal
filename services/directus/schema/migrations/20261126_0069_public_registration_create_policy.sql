-- 20261126_0069_public_registration_create_policy.sql
--
-- Public registration create-only Directus policy (AFC-1222 F2, follow-up to
-- AFC-1208/AFC-1211 F2 blocking finding and AFC-1221 QA NO-GO).
--
-- The public registration proxy (apps/web/server/api/register.post.ts) writes
-- with the public-scoped token. Until this migration, no tracked artifact
-- grants the public role create on event_registrations anywhere: the write
-- works only where an operator hand-granted it, which is an unreviewed access
-- grant on the one anonymous write path that handles children's data.
--
-- WHAT THIS FILE DOES
--   Finds the PUBLIC role's event_registrations/create permission row(s) —
--   the public role is the Directus convention `role IS NULL` — and sets
--   exactly one such row to exactly the 18-field allowlist below:
--   the 16 PUBLIC_REGISTRATION_FIELDS from
--   packages/shared/src/schemas/registration.ts PLUS the server-stamped
--   `source` and `consent_signed_at`. Matched by (collection, action,
--   role-null), never by hardcoded perm id, so it ports across environments.
--
-- THE ALLOWLIST (18 fields, sorted a-z). Canonical source: the 16
-- PUBLIC_REGISTRATION_FIELDS plus the two server-stamped columns the route
-- writes and the client cannot send.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No read/update/delete for the public role on event_registrations, ever.
--   If any role-NULL row on event_registrations carries an action other than
--   create, this file RAISEs (restrict_violation) instead of proceeding: a
--   public read on child PII is a shipping blocker, not a migration detail.
--   (data-model §9: the public role has no read on any non-public
--   collection; the matrix grants public read on events/public-only only.
--   The S9-vs-matrix wording conflict is resolved in the register route
--   header; the S9 sentence itself needs a CTO-ratified edit.)
--   No PII beyond what the registrant supplies: the allowlist carries no
--   ticket_code, registration_status, amount_*, payment_*, person or
--   group_code — those are Flow/staff columns.
--   No 404-never-403 change: collection, action and role bindings are
--   untouched; only `fields` is written.
--   No row creation: if no public create row exists, this file NOTICEs the
--   operator step and changes nothing. A migration must never invent an
--   access grant to make itself pass (0064 precedent).
--   No multi-row choice: more than one public create candidate RAISEs
--   (restrict_violation) rather than widening an ambiguous set.
--   No down script (0064 precedent): permission state is environment state;
--   reversal is a new forward migration, not a silent narrowing that could
--   close the live public surface on rollback.
--
-- GRANTS / ROLES. None. This file UPDATEs Directus system-table content; it
-- provisions no roles and grants no role-creation or superuser capability.
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002 (scripts/migration-privilege-gate.sh).
--
-- ---------------------------------------------------------------------------
-- Guarded skip (0003 pattern): on a database where Directus never booted
-- there is no directus_permissions table and nothing to update. The skip is
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
  v_create_hits integer := 0;
  v_allow_hits integer := 0;
  v_other_actions integer := 0;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261126_0069: directus_permissions not present (Directus never booted on this database). Re-run after the Directus system schema exists.';
    RETURN;
  END IF;

  -- Directus 11 uses policies, not permission.role. The policy cutover is
  -- implemented in 20261127_0073 instead of guessing a role column here.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'directus_permissions'
       AND column_name = 'policy'
  ) THEN
    RAISE NOTICE
      '20261126_0069: Directus 11 policy schema detected; public registration create grant is handled by 20261127_0073.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_other_actions
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action <> 'create'
     AND p.role IS NULL;

  IF v_other_actions > 0 THEN
    RAISE EXCEPTION
      'refusing 20261126_0069: % public (role-NULL) permission row(s) on event_registrations carry a non-create action. The public role must be create-only on registrations (child PII); remove the read/update/delete grant in a reviewed snapshot, then re-run.',
      v_other_actions
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_create_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.role IS NULL;

  SELECT count(*) INTO v_allow_hits
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations'
     AND p.action = 'create'
     AND p.role IS NULL
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_allow;

  IF v_allow_hits > 0 AND v_create_hits = v_allow_hits THEN
    RAISE NOTICE
      '20261126_0069 already applied: the public event_registrations/create permission carries the 18-field allowlist. No change.';
    RETURN;
  END IF;

  IF v_create_hits = 0 THEN
    RAISE NOTICE
      '20261126_0069 not applied: no public (role-NULL) event_registrations/create permission exists. As the Directus operator, grant the PUBLIC role create on event_registrations with exactly these fields: %. Then re-run this migration.',
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
     AND p.role IS NULL
     AND NOT ((SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_allow);

  RAISE NOTICE
    '20261126_0069 applied: public event_registrations/create permission set to the 18-field allowlist (16 public fields + source + consent_signed_at). No read/update/delete, no PII beyond registrant-supplied columns, 404-never-403 preserved.';
END
$$;
