-- 20261030_0064_public_event_read_policy.sql
--
-- Public events-read Directus policy: grant the public token exactly the
-- fields the signed-out surface reads (AFC-877 D4, follow-up to AFC-871
-- slice 2 / AFC-873).
--
-- ROOT CAUSE (staging probe AFC-876): the public detail endpoint
-- (apps/web/server/api/public/events/[id].get.ts) and the register proxy
-- (apps/web/server/api/register.post.ts) read section columns through the
-- public-scoped token, but the stored public events-read permission held
-- only the 6 calendar fields (staging perm 8050 verified:
-- branch, id, start_at, status, title, visibility). Reads of any other
-- column fail, so the detail surface and the pre-existing live-register
-- path 500. A temp grant of the full allowlist fixed the probe and was
-- then restored to the 6 fields. This migration is the reviewed,
-- least-privilege update path: a tracked file, not a manual dashboard
-- grant.
--
-- WHAT THIS FILE DOES
--   Finds the public events-read permission(s) in directus_permissions by
--   (collection, action, fields-as-a-set) — never by hardcoded perm id, so
--   it ports across environments — and sets exactly one known-legacy row
--   (the 6 calendar fields) to exactly the 29-field allowlist below.
--
-- THE ALLOWLIST (29 fields, sorted a-z). Canonical source: the 28 fields of
-- PUBLIC_DETAIL_FIELDS in apps/web/server/api/public/events/[id].get.ts
-- PLUS 'branch': the public calendar feed
-- (apps/web/server/api/calendar/public.get.ts) reads branch with the same
-- public token, and the 28-set lacks it. Verified subset coverage:
--   calendar PUBLIC_EVENT_FIELDS (6)            ⊆ allowlist
--   detail PUBLIC_DETAIL_FIELDS (28)            ⊆ allowlist
--   register loadPublicEvent fields (9)         ⊆ allowlist
--   testimonies events pre-read fields (2)     ⊆ allowlist
-- (branches-collection reads — id/name/zone — are a separate permission
-- and already work per probe checks 1-3; untouched here.)
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No PII, ever: no contact/guardian/medical content columns and no
--   registration write columns enter the allowlist (booleans such as
--   requires_guardian_consent / collect_medical describe the event, not a
--   child). Suite 58 asserts the absence.
--   No 404-never-403 change: only `fields` is written. Collection, action,
--   and role/policy bindings are untouched, so a non-public row still reads
--   as a 404 from the route predicates, never a 403 oracle.
--   No row creation: if the permission is not in a known state, this file
--   NOTICEs the operator step and changes nothing. A migration must never
--   invent an access grant to make itself pass.
--   No multi-row choice: more than one legacy candidate RAISEs
--   (restrict_violation) rather than widening an ambiguous set.
--   No down script (20261006_0003 precedent): permission state is
--   environment state; reversal is a new forward migration, not a silent
--   narrowing that could close the live public surface on rollback.
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
    'address', 'age_max', 'age_min', 'branch', 'capacity',
    'collect_medical', 'currency', 'description', 'end_at', 'event_type',
    'fee_amount', 'id', 'location', 'registration_closes_at',
    'registration_opens_at', 'registration_visibility',
    'requires_guardian_consent', 'resources', 'resources_visibility',
    'schedule', 'schedule_visibility', 'speakers', 'speakers_visibility',
    'start_at', 'status', 'summary', 'title', 'visibility',
    'waitlist_enabled'];
  v_legacy text[] := ARRAY[
    'branch', 'id', 'start_at', 'status', 'title', 'visibility'];
  v_legacy_hits integer := 0;
  v_allow_hits integer := 0;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261030_0064: directus_permissions not present (Directus never booted on this database). Re-run after the Directus system schema exists.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_legacy_hits
    FROM directus_permissions p
   WHERE p.collection = 'events'
     AND p.action = 'read'
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f) = v_legacy;

  SELECT count(*) INTO v_allow_hits
    FROM directus_permissions p
   WHERE p.collection = 'events'
     AND p.action = 'read'
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f) = v_allow;

  IF v_allow_hits > 0 AND v_legacy_hits = 0 THEN
    RAISE NOTICE
      '20261030_0064 already applied: the public events-read permission carries the 29-field allowlist. No change.';
    RETURN;
  END IF;

  IF v_legacy_hits = 0 THEN
    RAISE NOTICE
      '20261030_0064 not applied: no events/read permission holds the known 6-field set or the 29-field allowlist. As the Directus operator, set the PUBLIC events-read permission fields to exactly: %. Then re-run this migration.',
      array_to_string(v_allow, ',');
    RETURN;
  END IF;

  IF v_legacy_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261030_0064: % events/read permissions hold the legacy 6-field set. Widening an ambiguous set would grant blindly. As the Directus operator, keep exactly one public events-read permission and re-run.',
      v_legacy_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE directus_permissions p
     SET fields = v_allow
   WHERE p.collection = 'events'
     AND p.action = 'read'
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f) = v_legacy;

  RAISE NOTICE
    '20261030_0064 applied: public events-read permission widened from the 6 calendar fields to the 29-field public-surface allowlist (detail 28 + branch). No PII, no role/policy change, 404-never-403 preserved.';
END
$$;
