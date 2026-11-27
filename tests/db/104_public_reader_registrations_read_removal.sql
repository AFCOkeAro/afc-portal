-- tests/db/104_public_reader_registrations_read_removal.sql
--
-- AFC-1258 contract: the residual `afc-public-reader` READ on
-- event_registrations (parent AFC-1257; CTO decision on the parent).
--
-- Staging (Directus 11.17.4, per operator via AFC-1256 runbook `4586ad2`):
-- policy `afc-public-reader` holds a public-shaped READ on
-- `event_registrations` (`id,event,registration_status,ticket_code`).
-- Post-cutover tree (`4586ad2`) confirms every event_registrations read
-- rides `serverToken`; `publicToken` only ever reads `events`. No code
-- path reads registrations with the public token. This suite pins the
-- removal migration 20261128_0073, which lands AFTER AFC-1256 probes
-- 01-05 (sequencing gate: not bundled into the cutover window).
--
--   104.1 refuse-anon   -- reader policy linked from anonymous access +
--          exact 4-field read row present => the migration refuses
--          (restrict_violation). Replica-guard pattern per 104.5 (0276b42
--          precedent): the guard is exercised on a replica so the suite
--          file itself never aborts; the row is left in place.
--   104.2 transition    -- reader policy with NO anonymous linkage +
--          exact 4-field read row => the file deletes exactly that row;
--          decoys untouched (other collection, other action, other
--          policy); rerun is a NOTICE no-op.
--   104.3 refuse-fields -- field-set mismatch (extra column) refuses with
--          restrict_violation (replica guard); the row is left in place.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half —
-- signed-out reads of registrations 404/403 through the portal — runs
-- against staging with the real Directus policy (probes 01-05 gate), not
-- here. directus_permissions / directus_policies / directus_access are
-- test doubles (the 41 precedent): 0073 only reads policy / collection /
-- action / fields, the policy name, and the access linkage.
--
-- Probe hygiene: every row this suite writes is deleted before it ends
-- (the 86 precedent — later rollback probes assume empty registers).
-- The doubles are dropped at the end so they never leak into another
-- suite.

-- ---------------------------------------------------------------------------
-- Test doubles. v11 shapes the migration reads: permissions (policy /
-- collection / action / fields) and the policies + access rows that
-- resolve the reader set. Dropped at the end of the 0073 block so the
-- doubles never leak into another suite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directus_policies (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS directus_access (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role   uuid,
  "user" uuid,
  policy uuid
);

CREATE TABLE IF NOT EXISTS directus_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy      uuid,
  collection  text NOT NULL,
  action      text NOT NULL,
  fields      text NOT NULL DEFAULT '',
  permissions jsonb
);

-- ---------------------------------------------------------------------------
-- 104.1 REFUSE-ANON. Anonymous-linked reader + read row => refuse.
-- Replica guard (0276b42 104.5 precedent): a top-level \i of a refusing
-- migration would abort the suite, so the guard is exercised on a replica
-- while 104.2 exercises the file itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_reader uuid;
BEGIN
  INSERT INTO directus_policies (name) VALUES ('afc-public-reader') RETURNING id INTO v_reader;
  INSERT INTO directus_access (role, "user", policy) VALUES (NULL, NULL, v_reader);
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_reader, 'event_registrations', 'read', 'id,event,registration_status,ticket_code');
END $$;

DO $$
DECLARE
  v_reader uuid;
BEGIN
  SELECT pl.id INTO v_reader FROM directus_policies pl WHERE pl.name = 'afc-public-reader';

  -- The file's acceptance (1) verbatim, on a replica: any anonymous
  -- linkage refuses.
  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_access a WHERE a.policy = '''
    || v_reader::text || ''' AND a.role IS NULL AND a."user" IS NULL) > 0 THEN RAISE EXCEPTION ''refusing 20261128_0073 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'public-reader-read',
    'anonymous-linked reader refuses (live public surface, not a residual row)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.policy = v_reader
        AND p.collection = 'event_registrations'
        AND p.action = 'read'),
    '1', 'public-reader-read',
    'refusing file leaves the read row in place for the operator step');
END $$;

-- Clear the 104.1 fixture: the transition below needs the reader with NO
-- anonymous linkage.
DO $$
DECLARE
  v_reader uuid;
BEGIN
  SELECT pl.id INTO v_reader FROM directus_policies pl WHERE pl.name = 'afc-public-reader';
  DELETE FROM directus_permissions WHERE policy = v_reader;
  DELETE FROM directus_access WHERE policy = v_reader;
  DELETE FROM directus_policies WHERE id = v_reader;
END $$;

-- ---------------------------------------------------------------------------
-- 104.2 TRANSITION. Reader with no anonymous linkage + exact 4-field read
-- row => the file deletes exactly that row; decoys survive; rerun no-ops.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_reader uuid;
  v_staff uuid;
BEGIN
  INSERT INTO directus_policies (name) VALUES ('afc-public-reader') RETURNING id INTO v_reader;
  INSERT INTO directus_policies (name) VALUES ('staff-policy') RETURNING id INTO v_staff;

  -- No directus_access row for the reader: acceptance (1) holds.
  -- The residual row (field order shuffled: set comparison, not string).
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_reader, 'event_registrations', 'read', 'ticket_code,registration_status,event,id');

  -- Decoys the migration must not touch.
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_reader, 'events', 'read', 'id,title');
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_reader, 'event_registrations', 'create', 'event');
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_staff, 'event_registrations', 'read', 'id,event,registration_status,ticket_code');
END $$;

\i services/directus/schema/migrations/20261128_0073_remove_public_reader_registrations_read.sql

DO $$
DECLARE
  v_reader uuid;
  v_staff uuid;
BEGIN
  SELECT pl.id INTO v_reader FROM directus_policies pl WHERE pl.name = 'afc-public-reader';
  SELECT pl.id INTO v_staff FROM directus_policies pl WHERE pl.name = 'staff-policy';

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.policy = v_reader
        AND p.collection = 'event_registrations'
        AND p.action = 'read'),
    '0', 'public-reader-read',
    'the residual read row is gone (exactly that row deleted)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p WHERE p.policy = v_reader AND p.collection = 'events' AND p.action = 'read'),
    '1', 'public-reader-read',
    'other collections are untouched');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p WHERE p.policy = v_reader AND p.collection = 'event_registrations' AND p.action = 'create'),
    '1', 'public-reader-read',
    'other actions are untouched');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p WHERE p.policy = v_staff AND p.collection = 'event_registrations' AND p.action = 'read'),
    '1', 'public-reader-read',
    'other policies are untouched');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_access a WHERE a.policy = v_reader AND a.role IS NULL AND a."user" IS NULL),
    '0', 'public-reader-read',
    'anonymous check holds: zero anonymous rows for the reader');
END $$;

-- Rerun is a loud NOTICE no-op: still zero, decoys still intact.
\i services/directus/schema/migrations/20261128_0073_remove_public_reader_registrations_read.sql

DO $$
DECLARE
  v_reader uuid;
BEGIN
  SELECT pl.id INTO v_reader FROM directus_policies pl WHERE pl.name = 'afc-public-reader';

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.policy = v_reader
        AND p.collection = 'event_registrations'
        AND p.action = 'read'),
    '0', 'public-reader-read',
    'rerun: still zero read rows (already-removed NOTICE path)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p WHERE p.policy = v_reader),
    '2', 'public-reader-read',
    'rerun: the two reader decoys survive (events/read + registrations/create)');
END $$;

-- Clear the 104.2 fixture before the mismatch probe.
DO $$
BEGIN
  DELETE FROM directus_permissions WHERE policy IN
    (SELECT pl.id FROM directus_policies pl WHERE pl.name IN ('afc-public-reader', 'staff-policy'));
  DELETE FROM directus_policies WHERE name IN ('afc-public-reader', 'staff-policy');
END $$;

-- ---------------------------------------------------------------------------
-- 104.3 REFUSE-FIELDS. Field-set mismatch => refuse, row left in place.
-- Replica guard: the file's exact-set gate verbatim, so the suite never
-- aborts on a top-level \i of a refusing migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_reader uuid;
  v_expected text[] := ARRAY['event', 'id', 'registration_status', 'ticket_code'];
BEGIN
  INSERT INTO directus_policies (name) VALUES ('afc-public-reader') RETURNING id INTO v_reader;
  INSERT INTO directus_permissions (policy, collection, action, fields)
  VALUES (v_reader, 'event_registrations', 'read', 'id,event,registration_status,ticket_code,branch');

  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p WHERE p.policy = '''
    || v_reader::text || ''' AND p.collection = ''event_registrations'' AND p.action = ''read'' AND (SELECT array_agg(f ORDER BY f) FROM unnest(string_to_array(p.fields, '','')) AS f) = ARRAY[''event'',''id'',''registration_status'',''ticket_code'']) = 0 THEN RAISE EXCEPTION ''refusing 20261128_0073 test probe'' USING ERRCODE = ''restrict_violation''; END IF; END $rb$;',
    '23001', 'public-reader-read',
    'field-set mismatch refuses (never delete a grant blind)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.policy = v_reader
        AND p.collection = 'event_registrations'
        AND p.action = 'read'),
    '1', 'public-reader-read',
    'mismatched row is left in place for the operator step');

  DELETE FROM directus_permissions WHERE policy = v_reader;
  DELETE FROM directus_policies WHERE id = v_reader;
END $$;

-- Probe hygiene (86 precedent): no suite row survives.
DROP TABLE IF EXISTS directus_permissions;
DROP TABLE IF EXISTS directus_access;
DROP TABLE IF EXISTS directus_policies;
