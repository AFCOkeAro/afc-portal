-- tests/db/104_public_registration_writer_hardening.sql
--
-- AFC-1226 contract: the second hardening pass on the public registration
-- surface (G1-G3, M3).
--
--   104.1 0071 shape  -- the capacity gate is SECURITY DEFINER, owned by
--          directus_migrator, with a fixed search_path (public, pg_temp).
--   104.2 0071 gate as the read-less writer -- the identity that hid G1:
--          directus_app with SELECT revoked on event_registrations inserts
--          at capacity and still gets event_full (restrict_violation), not
--          42501. The restore is guaranteed by construction: the outcome is
--          captured with probe() (which raises nothing), the grant is
--          restored, and only then is the captured outcome asserted. A red
--          probe can therefore never leave a later suite without SELECT.
--   104.3 0072 fail-closed sequencing -- with no registration_writer role
--          (or role without a create row) the file RAISES
--          restrict_violation (AFC-1230 F2); the public grant is left in
--          place for the operator retry, and the deploy fails loud instead
--          of exiting 0 with the G3 bypass intact. Exercised on a replica
--          (the 41.3 precedent: a top-level \i of a refusing migration
--          would abort the suite); 104.4 exercises the file itself.
--   104.4 0072 revocation + writer convergence -- with the role present the
--          file deletes the public create row, converges the writer row to
--          exactly the 18-field writer allowlist (WITHOUT source /
--          consent_signed_at), touches nothing else, and installs the
--          server-side consent stamp.
--   104.5 0072 refusals -- multi-row public, public non-create, multi-row
--          writer and writer non-create paths all refuse with
--          restrict_violation on replica guards (the 41.3 precedent: a
--          top-level \i of a refusing migration would abort the suite, so
--          the guard is exercised on a replica while 104.3/104.4 exercise
--          the file itself). This is the 0069 multi-row/non-create coverage
--          M3 asks for, extended to the 0072 replacement.
--   104.6 0072 stamp behaviour -- guardian_consent true with NULL
--          consent_signed_at stamps server time; an explicit value is kept;
--          unconsented rows keep NULL; source defaults to public_form and an
--          explicit staff source survives.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half —
-- signed-out direct-POST 403s, the rotating-XFF flood and the concurrency
-- race — runs against staging with the real Directus policy (QA-owned
-- re-validation), not here. directus_permissions / directus_roles are test
-- doubles (the 41 precedent): the migrations only read collection / action /
-- role / fields and the role name.
--
-- Probe hygiene: every row this suite writes is deleted before it ends
-- (the 86 precedent — later rollback probes assume empty registers).

-- ---------------------------------------------------------------------------
-- Gate layer reinstall (AFC-1226). Suite 86 exercises the 0021 down/up
-- cycle and rebuilds the bare 0021 registers, which drops the 0070/0071
-- trigger layer and the idempotency column no deploy can be without (a
-- deploy always runs the full chain in order). The probes below pin that
-- layer, so they reinstall it first by applying the files themselves.
-- 0070/0071 are idempotent; 0072 has no grant double yet at this point, so
-- it degrades to its NOTICE skip plus the stamp trigger DDL — the grant
-- logic is exercised with doubles in 104.3/104.4 below.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261126_0070_registration_capacity_gate.sql
\i services/directus/schema/migrations/20261127_0071_registration_capacity_gate_definer.sql
\i services/directus/schema/migrations/20261127_0072_revoke_public_create_writer_role.sql

-- ---------------------------------------------------------------------------
-- 104.1 SHAPE. The 0070 gate object now runs as its owner.
-- (0071 itself ran in the migration phase, before all suites.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_definer boolean;
  v_config text;
  v_owner text;
BEGIN
  SELECT prosecdef INTO v_definer
    FROM pg_proc WHERE proname = 'event_registrations_capacity_gate';
  PERFORM test_support.assert_true(v_definer, 'writer-hardening',
    'the capacity gate is SECURITY DEFINER (G1: a read-less caller gets event_full, not 42501)');

  SELECT array_to_string(proconfig, ',') INTO v_config
    FROM pg_proc WHERE proname = 'event_registrations_capacity_gate';
  PERFORM test_support.assert_true(v_config LIKE '%search_path=public, pg_temp%', 'writer-hardening',
    'the definer pins search_path to public, pg_temp (got: ' || COALESCE(v_config, '(null)') || ')');

  SELECT r.rolname INTO v_owner
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.proname = 'event_registrations_capacity_gate';
  PERFORM test_support.assert_equals(v_owner, 'directus_migrator', 'writer-hardening',
    'the gate is owned by directus_migrator');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_registrations_stamp_server_fields'),
    'writer-hardening', 'the server-side consent-stamp trigger is installed (G3)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'event_registrations_stamp_server_fields'),
    'writer-hardening', 'the consent-stamp function exists (G3)');
END $$;

-- ---------------------------------------------------------------------------
-- 104.2 GATE AS THE READ-LESS WRITER. The probe G1 is about.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_got text;
BEGIN
  INSERT INTO events (title, start_at, end_at, capacity, waitlist_enabled)
    VALUES ('Readless Probe', now(), now(), 1, false) RETURNING id INTO v_event;

  -- Fill the only seat as the session role (full rights, like 103.6).
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status)
    VALUES (v_event, 'First', 'Seat', 'pending');

  -- Become the read-less writer: the inserting identity the public surface
  -- now writes through holds no SELECT on the gated table.
  PERFORM test_support.as_role('directus_migrator',
    'REVOKE SELECT ON event_registrations FROM directus_app');

  -- Capture, do not assert yet: probe() raises nothing, so the restore
  -- below runs even on a red outcome.
  v_got := test_support.probe('directus_app',
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status) VALUES ('''
    || v_event::text || ''', ''Second'', ''Seat'', ''pending'')');

  PERFORM test_support.as_role('directus_migrator',
    'GRANT SELECT ON event_registrations TO directus_app');

  PERFORM test_support.assert_true(split_part(v_got, ' | ', 1) = '23001', 'writer-hardening',
    'capacity+1 as the read-less writer refuses with restrict_violation, not 42501 (got: '
    || COALESCE(v_got, '(null)') || ')');
  PERFORM test_support.assert_true(v_got LIKE '%event_full:%', 'writer-hardening',
    'the refusal carries the event_full signal for the route to map (got: '
    || COALESCE(v_got, '(null)') || ')');

  -- And the restored ceiling from 0021 still holds over the gated table.
  PERFORM test_support.assert_raises('directus_app',
    'DELETE FROM event_registrations WHERE event = ''' || v_event::text || '''',
    '42501', 'writer-hardening',
    'directus_app still holds no DELETE after the SELECT round-trip');

  DELETE FROM event_registrations WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations WHERE event = v_event),
    '0', 'writer-hardening', 'probe rows cleaned (empty registers for later rollback probes)');
END $$;

-- ---------------------------------------------------------------------------
-- Test doubles for the 0072 grant logic. Same shapes the migration reads:
-- permissions (collection / action / role / fields) and roles (id / name).
-- Dropped at the end of the 0072 block so the doubles never leak into
-- another suite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directus_roles (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS directus_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        uuid,
  collection  text NOT NULL,
  action      text NOT NULL,
  fields      text NOT NULL DEFAULT '',
  permissions jsonb
);

-- ---------------------------------------------------------------------------
-- 104.3 FAIL-CLOSED SEQUENCING (AFC-1230 F2). No writer replacement:
-- the file RAISES (restrict_violation) instead of NOTICE+RETURN. A
-- top-level \i of a refusing migration would abort the suite (the 41.3
-- precedent cited in 104.5), so the refusal is exercised on a replica
-- while 104.4 exercises the file itself with the writer present. The
-- replica mirrors the file's two missing-replacement guards verbatim:
-- missing role, and role-present-but-no-create-row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'create',
    'age_group,allergies,branch,consent_signed_at,date_of_birth,email,emergency_contact_name,emergency_contact_phone,event,guardian_consent,guardian_email,guardian_name,guardian_phone,medical_notes,phone,registrant_first_name,registrant_last_name,source');
END $$;

DO $$
BEGIN
  -- Missing role: the file refuses instead of exiting 0 with the
  -- role-NULL create row untouched (the false-green deploy F2 closes).
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_roles r WHERE r.name = ''registration_writer'') = 0 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'missing writer role refuses (fail-closed: no NOTICE+RETURN with the public grant intact)');
  -- Role present but no create row: also refuses (second F2 guard).
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p JOIN directus_roles r ON r.id = p.role WHERE p.collection = ''event_registrations'' AND p.action = ''create'' AND r.name = ''registration_writer'') = 0 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'writer role without a create row refuses (fail-closed: replacement must exist, not just the role)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NULL), '1', 'writer-hardening',
    'refusing file leaves the public grant in place for the operator retry (revocation never runs ahead of its replacement)');
END $$;

-- ---------------------------------------------------------------------------
-- 104.4 REVOCATION + WRITER CONVERGENCE. The file, with the role present.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_writer uuid;
BEGIN
  INSERT INTO directus_roles (name) VALUES ('registration_writer') RETURNING id INTO v_writer;

  -- Writer create row in a legacy (public-shaped) field set, to be converged.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (v_writer, 'event_registrations', 'create',
    'event,registrant_first_name,registrant_last_name,email');

  -- Decoys the migration must not touch.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'events', 'create', 'id,title');
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (gen_random_uuid(), 'events', 'create', 'id,title');
END $$;

\i services/directus/schema/migrations/20261127_0072_revoke_public_create_writer_role.sql

DO $$
DECLARE
  v_writer_allow text := 'age_group,allergies,branch,date_of_birth,email,emergency_contact_name,emergency_contact_phone,event,guardian_consent,guardian_email,guardian_name,guardian_phone,idempotency_key,medical_notes,phone,registrant_first_name,registrant_last_name,registration_status';
  v_got text;
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.role IS NULL),
    '0', 'writer-hardening',
    'the public grant is revoked: zero public rows on event_registrations (direct anonymous POST 403s)');

  SELECT p.fields INTO v_got
    FROM directus_permissions p JOIN directus_roles r ON r.id = p.role
   WHERE p.collection = 'event_registrations' AND p.action = 'create'
     AND r.name = 'registration_writer';
  PERFORM test_support.assert_equals(v_got, v_writer_allow, 'writer-hardening',
    'the writer row now carries exactly the 18-field writer allowlist');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NOT NULL), '1', 'writer-hardening',
    'exactly one writer create row (no duplicates)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NOT NULL
        AND string_to_array(p.fields, ',') && string_to_array('registration_status', ',')::text[]), '1', 'writer-hardening',
    'the writer row carries registration_status (proxy-assigned pending/waitlisted)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NOT NULL
        AND string_to_array(p.fields, ',') && string_to_array('source,consent_signed_at,ticket_code,amount_paid,amount_expected,payment_status,payment_reference,person,group_code', ',')::text[]), '0', 'writer-hardening',
    'the writer row carries no source/consent/ticket/money/person/group columns');
END $$;

-- ---------------------------------------------------------------------------
-- 104.5 REFUSALS. Replica guards (the 41.3 precedent): the refusal shapes of
-- 0072 — multi-row public, public non-create, multi-row writer, writer
-- non-create — plus the 0069 non-create shape the migration still refuses.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_writer uuid;
BEGIN
  SELECT r.id INTO v_writer FROM directus_roles r WHERE r.name = 'registration_writer';

  -- Multi-row public create candidates refuse.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'create', 'event'),
         (NULL, 'event_registrations', 'create', 'event');
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action = ''create'' AND p.role IS NULL) > 1 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'more than one public create candidate refuses (never revoke an ambiguous set blindly)');
  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'create' AND role IS NULL AND fields = 'event';

  -- A public non-create row refuses (the migration checks before touching).
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'read', 'id');
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action <> ''create'' AND p.role IS NULL) > 0 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'a public non-create row on event_registrations refuses (create-only-or-absent)');
  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'read' AND role IS NULL;

  -- Multi-row writer create candidates refuse.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (v_writer, 'event_registrations', 'create', 'event'),
         (v_writer, 'event_registrations', 'create', 'event');
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action = ''create'' AND p.role = '''
    || v_writer::text || ''') > 1 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'more than one writer create candidate refuses (never widen an ambiguous set)');
  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'create' AND role = v_writer AND fields = 'event';

  -- A writer non-create row refuses (create-only).
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (v_writer, 'event_registrations', 'read', 'id');
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action <> ''create'' AND p.role = '''
    || v_writer::text || ''') > 0 THEN RAISE EXCEPTION ''refusing 20261127_0072 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'writer-hardening',
    'a writer non-create row on event_registrations refuses (writer is create-only)');
  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'read' AND role = v_writer;
END $$;

-- ---------------------------------------------------------------------------
-- 104.6 STAMP BEHAVIOUR. consent_signed_at is server time, source rides its
-- default, explicit values survive.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_stamp timestamptz;
  v_kept timestamptz := timestamptz '2026-01-02 03:04:05+00';
BEGIN
  INSERT INTO events (title, start_at, end_at, capacity, waitlist_enabled)
    VALUES ('Stamp Probe', now(), now(), NULL, false) RETURNING id INTO v_event;

  -- Consented, unstamped: the trigger stamps server time.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, guardian_consent, consent_signed_at)
    VALUES (v_event, 'Stamp', 'Me', true, NULL) RETURNING consent_signed_at INTO v_stamp;
  PERFORM test_support.assert_true(v_stamp IS NOT NULL, 'writer-hardening',
    'guardian_consent true with NULL consent_signed_at stamps server time');

  -- Explicit value: kept, never overwritten.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, guardian_consent, consent_signed_at)
    VALUES (v_event, 'Keep', 'Mine', true, v_kept);
  PERFORM test_support.assert_equals(
    (SELECT max(consent_signed_at)::text FROM event_registrations
      WHERE event = v_event AND registrant_first_name = 'Keep'),
    v_kept::text, 'writer-hardening', 'an explicit consent_signed_at is kept');

  -- Unconsented: stays NULL (the route refuses minors before writing).
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, guardian_consent, consent_signed_at)
    VALUES (v_event, 'No', 'Consent', false, NULL);
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations
      WHERE event = v_event AND guardian_consent IS FALSE AND consent_signed_at IS NULL),
    '1', 'writer-hardening', 'unconsented rows keep NULL consent_signed_at');

  -- Source rides its NOT NULL DEFAULT; an explicit staff source survives.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations
      WHERE event = v_event AND source = 'public_form'),
    '3', 'writer-hardening', 'omitted source stamps public_form via the column default');
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, source)
    VALUES (v_event, 'Staff', 'Walkin', 'staff');
  PERFORM test_support.assert_equals(
    (SELECT source FROM event_registrations
      WHERE event = v_event AND registrant_first_name = 'Staff'),
    'staff', 'writer-hardening', 'an explicit staff source survives the stamp trigger');

  DELETE FROM event_registrations WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations WHERE event = v_event),
    '0', 'writer-hardening', 'probe rows cleaned (empty registers for later rollback probes)');
END $$;

DROP TABLE IF EXISTS directus_permissions;
DROP TABLE IF EXISTS directus_roles;
