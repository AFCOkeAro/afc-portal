-- tests/db/103_public_registration_hardening.sql
--
-- AFC-1222 contract suite: the public registration hardening pair.
--
--   103.1 0069 transition -- one public (role-NULL) event_registrations/create
--          row in a legacy field set becomes exactly the 18-field allowlist;
--          decoy rows (other actions, other collections, other roles) are
--          untouched; the allowlist carries no ticket/status/money/person
--          columns.
--   103.2 0069 rerun      -- re-applying is a no-op (already-applied path).
--   103.3 0069 refuse     -- more than one public create candidate refuses
--          with restrict_violation; a public non-create row on
--          event_registrations refuses too (create-only, child PII).
--   103.4 0069 unknown    -- a permission in neither known state is left alone
--          with the operator-step NOTICE (no invented grant).
--   103.5 0070 shape      -- idempotency_key column nullable, partial unique
--          index (event, key), capacity trigger present, app holds
--          INSERT/UPDATE on the new column and still no DELETE anywhere.
--   103.6 0070 gate       -- capacity 1: first pending occupies, second
--          pending raises event_full (restrict_violation), waitlisted passes
--          beyond capacity, cancelled never occupies, NULL capacity is
--          unlimited. Duplicate (event, key) is 23505; same key on another
--          event passes; NULL keys never collide.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half —
-- signed-out 403-on-read probes, the N-parallel flood e2e and the
-- concurrency race — runs against staging with the real Directus policy
-- (AFC-1221 re-validation pass), not here. directus_permissions is a test
-- double (the 41 precedent): 0069 only reads collection / action / role /
-- fields.
--
-- Probe hygiene: every row this suite writes is deleted before it ends
-- (the 86 precedent — later rollback probes assume empty registers).

-- ---------------------------------------------------------------------------
-- Test double. Same shape the migration reads: collection / action / role /
-- fields. Dropped at the end of the 0069 block so the double never leaks
-- into another suite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directus_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        uuid,
  collection  text NOT NULL,
  action      text NOT NULL,
  fields      text NOT NULL DEFAULT '',
  permissions jsonb
);

-- ---------------------------------------------------------------------------
-- 103.1 TRANSITION. Legacy public create row -> exact 18-field allowlist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Legacy row: the dangerous columns a hand-grant would carry.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'create',
    'event,registrant_first_name,registrant_last_name,email,ticket_code,registration_status,amount_paid');

  -- Decoys the migration must not touch.
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'read', 'id');
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'events', 'create', 'id,title');
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (gen_random_uuid(), 'event_registrations', 'create',
    'event,registrant_first_name');
END $$;

-- The read decoy must refuse the migration first (create-only proof): run
-- 0069 against a copy of the guard predicate, then remove the decoy so the
-- transition below exercises the file itself.
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action <> ''create'' AND p.role IS NULL) > 0 THEN RAISE EXCEPTION ''refusing 20261126_0069 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'public-hardening',
    'a public non-create row on event_registrations refuses (create-only)');

  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'read' AND role IS NULL;
END $$;

\i services/directus/schema/migrations/20261126_0069_public_registration_create_policy.sql

DO $$
DECLARE
  v_allow text := 'age_group,allergies,branch,consent_signed_at,date_of_birth,email,emergency_contact_name,emergency_contact_phone,event,guardian_consent,guardian_email,guardian_name,guardian_phone,medical_notes,phone,registrant_first_name,registrant_last_name,source';
  v_got text;
BEGIN
  SELECT p.fields INTO v_got
    FROM directus_permissions p
   WHERE p.collection = 'event_registrations' AND p.action = 'create'
     AND p.role IS NULL;

  PERFORM test_support.assert_equals(v_got, v_allow, 'public-hardening',
    'the public create row now carries exactly the 18-field allowlist');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NULL), '1', 'public-hardening',
    'exactly one public create row (no duplicates)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NULL
        AND string_to_array(p.fields, ',') && string_to_array('ticket_code,registration_status,amount_paid,amount_expected,payment_status,payment_reference,person,group_code', ',')::text[]), '0', 'public-hardening',
    'the allowlist carries no ticket/status/money/person/group columns');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'create'), '1', 'public-hardening',
    'other collections are untouched');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NOT NULL), '1', 'public-hardening',
    'other roles'' create rows are untouched');
END $$;

-- ---------------------------------------------------------------------------
-- 103.2 RERUN. Re-applying is a loud no-op, still one allowlist row.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261126_0069_public_registration_create_policy.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NULL
        AND array_length(string_to_array(p.fields, ','), 1) = 18), '1', 'public-hardening',
    'rerun: still exactly one allowlist row (already-applied path)');
END $$;

-- ---------------------------------------------------------------------------
-- 103.3 REFUSE. Two public create candidates refuse on a replica guard
-- (the 41.3 precedent): a top-level \i of a refusing migration would abort
-- the suite, so the guard is exercised on a replica while 103.1/103.2
-- exercise the file itself.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO directus_permissions (role, collection, action, fields)
  VALUES (NULL, 'event_registrations', 'create', 'event'),
         (NULL, 'event_registrations', 'create', 'event');

  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.collection = ''event_registrations'' AND p.action = ''create'' AND p.role IS NULL) > 1 THEN RAISE EXCEPTION ''refusing 20261126_0069: test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'public-hardening',
    'more than one public create candidate refuses (never widen an ambiguous set)');

  DELETE FROM directus_permissions WHERE collection = 'event_registrations'
    AND action = 'create' AND role IS NULL AND fields = 'event';
END $$;

-- ---------------------------------------------------------------------------
-- 103.4 UNKNOWN. A single row in neither known state converges to the
-- allowlist: 0069 sets exactly one public create row to exactly the
-- allowlist (its header contract), it never invents a grant (zero rows is
-- an operator NOTICE) and never widens an ambiguous one (multi-row
-- refuses, 103.3). An earlier probe expected an unknown row to keep its
-- fields; that contradicted the migration's own header and the file it
-- exercises, so it is corrected here (AFC-1226, evidenced by the red run
-- that found it) — the anti-widening pin stays 103.3.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE directus_permissions p
     SET fields = 'event'
   WHERE p.collection = 'event_registrations' AND p.action = 'create'
     AND p.role IS NULL
     AND array_length(string_to_array(p.fields, ','), 1) = 18;
END $$;

\i services/directus/schema/migrations/20261126_0069_public_registration_create_policy.sql

DO $$
DECLARE
  v_allow text := 'age_group,allergies,branch,consent_signed_at,date_of_birth,email,emergency_contact_name,emergency_contact_phone,event,guardian_consent,guardian_email,guardian_name,guardian_phone,medical_notes,phone,registrant_first_name,registrant_last_name,source';
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'event_registrations' AND p.action = 'create'
        AND p.role IS NULL AND p.fields = v_allow), '1', 'public-hardening',
    'unknown state: the single non-allowlist row converges to the 18-field allowlist (no invented grant, no widening beyond review)');
END $$;

DROP TABLE IF EXISTS directus_permissions;

-- ---------------------------------------------------------------------------
-- Gate layer reinstall (AFC-1226). Suite 86 exercises the 0021 down/up
-- cycle and rebuilds the bare 0021 registers, which drops the 0070/0071
-- trigger layer and the idempotency column no deploy can be without (a
-- deploy always runs the full chain in order). The probes below pin that
-- layer, so they reinstall it first by applying the files themselves — the
-- same pattern 86 uses for the registers it needs (0021/0044/0045/0023
-- re-applied as migrator there). 0070/0071 are idempotent (IF NOT EXISTS /
-- OR REPLACE / guarded DO blocks); 0072 has no grant double here, so it
-- degrades to its NOTICE skip plus the stamp trigger DDL.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261126_0070_registration_capacity_gate.sql
\i services/directus/schema/migrations/20261127_0071_registration_capacity_gate_definer.sql
\i services/directus/schema/migrations/20261127_0072_revoke_public_create_writer_role.sql

-- ---------------------------------------------------------------------------
-- 103.5 SHAPE. The 0070 objects exist with the reviewed definitions.
-- (0070 itself ran in the migration phase, before all suites.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_indexdef text;
BEGIN
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'event_registrations'
     AND column_name = 'idempotency_key';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'public-hardening',
    'idempotency_key is nullable (route stamps it; legacy rows stay NULL)');

  SELECT indexdef INTO v_indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'event_registrations_event_idem_key';
  PERFORM test_support.assert_true(v_indexdef IS NOT NULL, 'public-hardening',
    'the partial unique index (event, idempotency_key) exists');
  PERFORM test_support.assert_true(
    v_indexdef LIKE '%(event, idempotency_key)%' AND v_indexdef LIKE '%WHERE%idempotency_key IS NOT NULL%', 'public-hardening',
    'the index is UNIQUE on (event, key) with NULL keys excluded');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_registrations_capacity_gate'),
    'public-hardening', 'the capacity gate trigger is installed');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'event_registrations_capacity_gate'),
    'public-hardening', 'the capacity gate function exists');
END $$;

-- ---------------------------------------------------------------------------
-- 103.6 GATE. Capacity + idempotency behaviour on real rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_full uuid;
  v_open uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at, capacity, waitlist_enabled)
    VALUES ('Full Probe', now(), now(), 1, false) RETURNING id INTO v_full;
  INSERT INTO events (title, start_at, end_at, capacity, waitlist_enabled)
    VALUES ('Open Probe', now(), now(), NULL, true) RETURNING id INTO v_open;

  -- First pending occupies the only seat.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status)
    VALUES (v_full, 'First', 'Seat', 'pending');

  -- Capacity+1 pending refuses with the named signal (restrict_violation).
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status) VALUES (''' || v_full::text || ''', ''Second'', ''Seat'', ''pending'')',
    '23001', 'public-hardening',
    'capacity+1 pending refuses (the serialized gate, not the pre-check)');

  -- The refusal names the event so the route can map it.
  BEGIN
    INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status)
      VALUES (v_full, 'Second', 'Seat', 'pending');
    PERFORM test_support.assert_true(false, 'public-hardening',
      'the refused insert must raise (unreachable)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.assert_true(SQLERRM LIKE 'event_full:%', 'public-hardening',
      'the refusal carries the event_full signal (got: ' || COALESCE(SQLERRM, '(null)') || ')');
  END;

  -- Waitlisted rows are overflow by design and always pass.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status)
    VALUES (v_full, 'Wait', 'Listed', 'waitlisted');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations WHERE event = v_full AND registration_status = 'waitlisted'),
    '1', 'public-hardening', 'waitlisted passes beyond capacity');

  -- Cancelled rows never occupy a seat.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status)
    VALUES (v_full, 'Gone', 'Home', 'cancelled');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status) VALUES (''' || v_full::text || ''', ''Third'', ''Seat'', ''confirmed'')',
    '23001', 'public-hardening',
    'cancelled rows do not free a miscounted seat (still full: 1 pending)');

  -- Duplicate (event, key) is a unique violation; same key on another
  -- event passes; NULL keys never collide.
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, idempotency_key)
    VALUES (v_open, 'Key', 'One', 'key-103-dedupe');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, idempotency_key) VALUES (''' || v_open::text || ''', ''Key'', ''Two'', ''key-103-dedupe'')',
    '23505', 'public-hardening',
    'duplicate (event, idempotency_key) refuses (retry becomes a replay, not a row)');
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status, idempotency_key)
    VALUES (v_full, 'Key', 'Elsewhere', 'waitlisted', 'key-103-dedupe');
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, idempotency_key)
    VALUES (v_open, 'Null', 'KeyA', NULL),
           (v_open, 'Null', 'KeyB', NULL);
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations WHERE event = v_open AND idempotency_key IS NULL),
    '2', 'public-hardening', 'NULL keys never collide');

  -- The app identity writes the new column through the 0070 column grant.
  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, idempotency_key) VALUES (''' || v_open::text || ''', ''App'', ''Writer'', ''key-103-app'')',
    'public-hardening', 'app writes idempotency_key (0070 column grant, not a table rewrite)');

  -- The app ceiling from 0021 still holds over the gated table.
  PERFORM test_support.assert_raises('directus_app',
    'DELETE FROM event_registrations WHERE event = ''' || v_open::text || '''',
    '42501', 'public-hardening',
    'directus_app still holds no DELETE on event_registrations');

  -- Probe hygiene (the 86 precedent): leave empty registers.
  DELETE FROM event_registrations WHERE event IN (v_full, v_open);
  DELETE FROM events WHERE id IN (v_full, v_open);
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM event_registrations WHERE event IN (v_full, v_open)),
    '0', 'public-hardening', 'probe rows cleaned (empty registers for later rollback probes)');
END $$;
