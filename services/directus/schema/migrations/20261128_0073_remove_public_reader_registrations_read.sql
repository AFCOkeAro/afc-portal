-- 20261128_0073_remove_public_reader_registrations_read.sql
--
-- AFC-1258 (child of AFC-1257; CTO decision on the parent). Remove the
-- residual public-shaped READ on event_registrations held by the
-- `afc-public-reader` Directus policy.
--
-- CONTEXT (staging, Directus 11.17.4, per operator via AFC-1256 runbook
-- `4586ad2`): policy `afc-public-reader` holds a public-shaped READ on
-- `event_registrations` (`id,event,registration_status,ticket_code`)
-- through the Public Reader role. The 0069/0072 migration public set
-- (anonymous `directus_access` role+"user" NULL, plus the portal-public
-- service-user fallback) does NOT resolve this policy: it is outside the
-- cutover set. Operator finding (authoritative): not anonymous; the portal
-- does not use it. Post-cutover tree (`4586ad2`) confirms: every
-- `event_registrations` read rides `serverToken` (capacity count, dedupe
-- replay, readback); `publicToken` only ever reads `events`
-- (`loadPublicEvent`). No code path reads registrations with the public
-- token.
--
-- SEQUENCING. Do NOT bundle into the AFC-1256 cutover window. This lands
-- AFTER probes 01-05 pass on staging. Do not touch 0069/0070/0071/0072.
--
-- WHAT THIS FILE DOES
--   Resolves the reader policy BY NAME
--   (`directus_policies.name = 'afc-public-reader'` — policy UUIDs differ
--   per environment, so the stable name is the match key) and deletes
--   exactly one permission row:
--     policy = <reader-id> AND collection = 'event_registrations'
--     AND action = 'read'
--   carrying exactly the 4-field set below. Matched by (policy,
--   collection, action), never by hardcoded perm id, so it ports across
--   environments.
--
-- THE FIELD SET (4 fields, sorted a-z). The residual read carries exactly
-- `event,id,registration_status,ticket_code`. Compared as a SET
-- (array_agg ORDER BY), not as a string: column order in the stored
-- comma list is not significant, membership is.
--
-- ACCEPTANCE GATES (fail-closed, child PII)
--   1. Anonymous linkage: `SELECT count(*) FROM directus_access
--      WHERE policy = <reader-id> AND role IS NULL AND "user" IS NULL`
--      must be 0, else RAISE restrict_violation with the operator step.
--      A reader reachable from anonymous access is a live public surface,
--      not a residual row — do not silently delete it; that is a different
--      incident.
--   2. Exact set: if the single read row's field set is not exactly the
--      4-field set, RAISE restrict_violation naming the actual set rather
--      than deleting blind. Zero read rows is a loud NOTICE (already
--      removed), not an error.
--   3. Ambiguity: zero reader policies is a loud NOTICE + RETURN (nothing
--      to do — never invent a grant to make the file pass); more than one
--      policy named `afc-public-reader`, or more than one matching read
--      row, RAISEs restrict_violation (never widen an ambiguous set).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No non-read narrowing: this file deletes the one read row only. Other
--   collections, other actions, other policies are untouched — including
--   any `afc-public-reader` create/update/delete row, which would be a
--   separate reviewed decision, not a silent extra delete here.
--   No row creation, no policy/access creation: if the reader policy or
--   the read row does not exist, this file NOTICEs and changes nothing.
--   A migration must never invent an access grant to make itself pass
--   (0064/0069 precedent).
--   No GRANT/REVOKE, no role/policy/access creation: content DELETE only.
--   No down script (0064 precedent): permission state is environment
--   state; reversal is a new forward migration, not a silent re-grant
--   that could reopen the public surface on rollback.
--
-- GRANTS / ROLES. None. This file DELETEs Directus system-table content;
-- it provisions no roles, no policies, no access rows, and grants no
-- role-creation or superuser capability. Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002 (scripts/migration-privilege-gate.sh).
--
-- ---------------------------------------------------------------------------
-- Guarded skip (0003 pattern): on a database where Directus never booted
-- there are no Directus system tables and nothing to delete. The skip is
-- loud (NOTICE) so a deploy log shows it rather than hiding it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'event', 'id', 'registration_status', 'ticket_code'];
  v_reader_id uuid;
  v_reader_hits integer := 0;
  v_has_policy integer := 0;
  v_has_role integer := 0;
  v_anon integer := 0;
  v_read_hits integer := 0;
  v_read_ok integer := 0;
  v_actual text;
BEGIN
  IF to_regclass('public.directus_permissions') IS NULL
     OR to_regclass('public.directus_policies') IS NULL
     OR to_regclass('public.directus_access') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261128_0073: Directus v11 system tables not present (Directus never booted on this database). Re-run after the Directus system schema exists.';
    RETURN;
  END IF;

  -- Target-shape guard (0072 precedent): this file speaks the v11 policy
  -- model. A v10 database (role column present) is the wrong target —
  -- refuse, do not guess.
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
      'refusing 20261128_0073: directus_permissions still carries the v10 role column. This file targets the v11 policy model (CTO-ratified; repo pins directus/directus:11). Migrate Directus to v11 first, then re-run.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_has_policy = 0 THEN
    RAISE EXCEPTION
      'refusing 20261128_0073: directus_permissions has neither a policy nor a role column — an unknown permission shape. Refusing to delete an access grant blindly.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Resolve the reader policy BY NAME. UUIDs differ per environment; the
  -- stable name is the match key.
  SELECT count(*) INTO v_reader_hits
    FROM directus_policies pl
   WHERE pl.name = 'afc-public-reader';

  IF v_reader_hits = 0 THEN
    RAISE NOTICE
      '20261128_0073: no Directus policy named afc-public-reader. Nothing to do — never invent a grant to make this file pass.';
    RETURN;
  END IF;

  IF v_reader_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261128_0073: % Directus policies named afc-public-reader. Widening an ambiguous set would delete blindly. Keep exactly one afc-public-reader policy and re-run.',
      v_reader_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT pl.id INTO v_reader_id
    FROM directus_policies pl
   WHERE pl.name = 'afc-public-reader';

  -- Acceptance (1): the reader must NOT be reachable from anonymous
  -- access. An anonymous-linked reader is a live public surface, not a
  -- residual row — unlinking it silently is a different incident.
  SELECT count(*) INTO v_anon
    FROM directus_access a
   WHERE a.policy = v_reader_id
     AND a.role IS NULL
     AND a."user" IS NULL;

  IF v_anon > 0 THEN
    RAISE EXCEPTION
      'refusing 20261128_0073: the afc-public-reader policy (%) is reachable from anonymous access (directus_access with role AND "user" NULL, % row(s)). Do not silently delete a live public grant. As the Directus operator, confirm no signed-out surface reads event_registrations through this policy, unlink it from anonymous access in a reviewed snapshot, then re-run.',
      v_reader_id, v_anon
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The one residual read row.
  SELECT count(*) INTO v_read_hits
    FROM directus_permissions p
   WHERE p.policy = v_reader_id
     AND p.collection = 'event_registrations'
     AND p.action = 'read';

  IF v_read_hits = 0 THEN
    RAISE NOTICE
      '20261128_0073: no afc-public-reader event_registrations/read permission remains. Already removed.';
    RETURN;
  END IF;

  IF v_read_hits > 1 THEN
    RAISE EXCEPTION
      'refusing 20261128_0073: % afc-public-reader event_registrations/read rows. Widening an ambiguous set would delete blindly. Keep exactly one read permission and re-run.',
      v_read_hits
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Exact-set gate: the row must carry exactly the 4-field residual set.
  SELECT count(*) INTO v_read_ok
    FROM directus_permissions p
   WHERE p.policy = v_reader_id
     AND p.collection = 'event_registrations'
     AND p.action = 'read'
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, ',')) AS f) = v_expected;

  IF v_read_ok = 0 THEN
    SELECT p.fields INTO v_actual
      FROM directus_permissions p
     WHERE p.policy = v_reader_id
       AND p.collection = 'event_registrations'
       AND p.action = 'read';
    RAISE EXCEPTION
      'refusing 20261128_0073: the afc-public-reader event_registrations/read row carries fields [%], not exactly [event,id,registration_status,ticket_code]. As the Directus operator, confirm the actual set in a reviewed snapshot, then re-run — this file never deletes a grant blind.',
      COALESCE(v_actual, '(null)')
      USING ERRCODE = 'restrict_violation';
  END IF;

  DELETE FROM directus_permissions p
   WHERE p.policy = v_reader_id
     AND p.collection = 'event_registrations'
     AND p.action = 'read';

  RAISE NOTICE
    '20261128_0073 applied: afc-public-reader event_registrations/read permission (event,id,registration_status,ticket_code) removed. No other collection/action/policy touched.';
END
$$;
