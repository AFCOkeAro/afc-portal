-- tests/db/95_minutes_attendee_policy_mirror.sql
--
-- AFC-704 scope item 1: F1 policy mirror for the ADR-0012
-- creator-may-attach-to-own-draft exception.
--
-- The portal route lets office_minutes:create holders attach only to their
-- OWN DRAFT in-scope minutes. Staging has no directus_relations metadata, so
-- a relational Directus filter (minute.status / minute.created_by) fails
-- closed; migration 20261020_0033 denormalises the two parent facts onto the
-- attendee row (minute_status, minute_created_by, trigger-maintained) so the
-- flat canonical filter (MINUTES_ATTENDEE_CREATE_FILTER) can express all
-- three conditions. Branch/zone already ride along via 0030's afc_set_scope.
--
--   95.1  shape    -- columns + trigger + function + index exist.
--   95.2  copy     -- an attendee written with only (minute, person) receives
--                     the parent's status/created_by/branch/zone.
--   95.3  null     -- a legacy parent with NULL created_by yields NULL (which
--                     never satisfies the policy's _eq: fails closed).
--   95.4  drift    -- a later draft->final transition does NOT rewrite
--                     existing attendee rows (create-time inputs, not reads);
--                     attaches made after the transition copy 'final'.
--   95.5  rerun    -- re-applying 0033 changes nothing (idempotent).
--   95.6  ceiling  -- directus_app writes the three client columns and reads
--                     the denorm, but cannot spoof it (42501: not granted).
--
-- What this suite does NOT assert: the HTTP 403/2xx half and the
-- portal-allow-IFF-policy-allow mapping -- those live in
-- tests/web/office.contract.mjs (parity block). A SQL suite asserting HTTP
-- status codes would be testing the wrong layer (79 header precedent).

-- ---------------------------------------------------------------------------
-- 95.0  FIXTURES. Fixed ids so this file reruns cleanly in one database.
--        Synthetic user ids (directus_users rows are not seeded here; the
--        denorm columns are bare uuids by design, same as attendee_user).
-- ---------------------------------------------------------------------------
INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000095', 'active')
ON CONFLICT (id) DO NOTHING;

-- Draft owned by USER_A: never mutated (copy test anchor).
INSERT INTO office_minutes (id, title, meeting_date, branch, status, created_by)
VALUES ('32111111-1111-4111-8111-111111111111',
        'Policy mirror draft anchor', DATE '2026-10-04',
        (SELECT id FROM branches WHERE zone IS NOT NULL ORDER BY code LIMIT 1),
        'draft', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Final owned by USER_A: attaches copy 'final' (negative denorm check).
INSERT INTO office_minutes (id, title, meeting_date, branch, status, created_by)
VALUES ('32222222-2222-4222-8222-222222222222',
        'Policy mirror final anchor', DATE '2026-10-04',
        (SELECT id FROM branches WHERE zone IS NOT NULL ORDER BY code LIMIT 1),
        'final', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Draft with NULL created_by (legacy shape): denorm must be NULL.
INSERT INTO office_minutes (id, title, meeting_date, branch, status, created_by)
VALUES ('32333333-3333-4333-8333-333333333333',
        'Policy mirror legacy anchor', DATE '2026-10-04',
        (SELECT id FROM branches WHERE zone IS NOT NULL ORDER BY code LIMIT 1),
        'draft', NULL)
ON CONFLICT (id) DO NOTHING;

-- Drift anchor: starts draft, moved to final inside 95.4 (stays final).
INSERT INTO office_minutes (id, title, meeting_date, branch, status, created_by)
VALUES ('32444444-4444-4444-8444-444444444444',
        'Policy mirror drift anchor', DATE '2026-10-04',
        (SELECT id FROM branches WHERE zone IS NOT NULL ORDER BY code LIMIT 1),
        'draft', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- App-ceiling probe anchor: draft owned by USER_A, written only by
-- directus_app below (0013's column grant excludes id, so the probe cannot
-- name one -- the row is found by (minute, person) afterwards).
INSERT INTO office_minutes (id, title, meeting_date, branch, status, created_by)
VALUES ('32555555-5555-4555-8555-555555555555',
        'Policy mirror app probe anchor', DATE '2026-10-04',
        (SELECT id FROM branches WHERE zone IS NOT NULL ORDER BY code LIMIT 1),
        'draft', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO minutes_attendees (id, minute, person)
VALUES
  ('33111111-1111-4111-8111-111111111111',
    '32111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000095'),
  ('33222222-2222-4222-8222-222222222222',
    '32222222-2222-4222-8222-222222222222',
    '00000000-0000-4000-8000-000000000095'),
  ('33333333-3333-4333-8333-333333333333',
    '32333333-3333-4333-8333-333333333333',
    '00000000-0000-4000-8000-000000000095'),
  ('33444444-4444-4444-8444-444444444444',
    '32444444-4444-4444-8444-444444444444',
    '00000000-0000-4000-8000-000000000095')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 95.1  SHAPE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'minutes_attendees'
               AND column_name = 'minute_status'),
    'policy_mirror', 'minute_status denorm column exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'minutes_attendees'
               AND column_name = 'minute_created_by'),
    'policy_mirror', 'minute_created_by denorm column exists');
  PERFORM test_support.assert_true(
    to_regprocedure('public.afc_set_minute_attach_scope()') IS NOT NULL,
    'policy_mirror', 'the 0033 trigger function exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
             WHERE c.relname = 'minutes_attendees'
               AND g.tgname = 'afc_set_minute_attach_scope'),
    'policy_mirror', 'the 0033 trigger is attached to minutes_attendees');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'minutes_attendees_minute_attach_idx'),
    'policy_mirror', 'the (minute_status, minute_created_by) index exists');
END $$;

-- ---------------------------------------------------------------------------
-- 95.2  COPY. Client writes (minute, person); the trigger fills the rest.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_zone uuid;
BEGIN
  SELECT branch, zone INTO v_branch, v_zone
    FROM office_minutes WHERE id = '32111111-1111-4111-8111-111111111111';

  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33111111-1111-4111-8111-111111111111'),
    'draft', 'policy_mirror', 'draft parent copies draft status');
  PERFORM test_support.assert_equals(
    (SELECT minute_created_by::text FROM minutes_attendees
      WHERE id = '33111111-1111-4111-8111-111111111111'),
    'a0000000-0000-4000-8000-000000000001', 'policy_mirror',
    'owned parent copies the author id');
  PERFORM test_support.assert_equals(
    (SELECT branch::text FROM minutes_attendees
      WHERE id = '33111111-1111-4111-8111-111111111111'),
    v_branch::text, 'policy_mirror',
    '0030 branch denorm still rides along next to the 0033 columns');
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM minutes_attendees
      WHERE id = '33111111-1111-4111-8111-111111111111'),
    v_zone::text, 'policy_mirror',
    '0030 zone denorm still rides along next to the 0033 columns');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33222222-2222-4222-8222-222222222222'),
    'final', 'policy_mirror',
    'final parent copies final status (policy _eq draft then denies)');
END $$;

-- ---------------------------------------------------------------------------
-- 95.3  NULL FAILS CLOSED. Legacy parent, NULL created_by -> NULL denorm.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT minute_created_by FROM minutes_attendees
      WHERE id = '33333333-3333-4333-8333-333333333333') IS NULL,
    'policy_mirror',
    'NULL parent author yields NULL denorm (never satisfies _eq $CURRENT_USER)');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33333333-3333-4333-8333-333333333333'),
    'draft', 'policy_mirror',
    'legacy draft parent still copies its status');
END $$;

-- ---------------------------------------------------------------------------
-- 95.4  DRIFT. Parent draft->final does not rewrite existing rows; later
--        attaches copy the new status.
-- ---------------------------------------------------------------------------
UPDATE office_minutes SET status = 'final'
 WHERE id = '32444444-4444-4444-8444-444444444444';

INSERT INTO minutes_attendees (id, minute, person)
VALUES ('33555555-5555-4555-8555-555555555555',
        '32444444-4444-4444-8444-444444444444',
        '00000000-0000-4000-8000-000000000095')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33444444-4444-4444-8444-444444444444'),
    'draft', 'policy_mirror',
    'attach made while draft keeps draft after the parent publishes (create-time input, not a read model)');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33555555-5555-4555-8555-555555555555'),
    'final', 'policy_mirror',
    'attach made after publishing copies final (policy denies it)');
END $$;

-- ---------------------------------------------------------------------------
-- 95.5  RERUN. Re-applying 0033 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0033_minutes_attendee_policy_mirror.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
      WHERE c.relname = 'minutes_attendees'
        AND g.tgname = 'afc_set_minute_attach_scope'),
    '1', 'policy_mirror', 're-apply leaves exactly one 0033 trigger');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33111111-1111-4111-8111-111111111111'),
    'draft', 'policy_mirror', 're-apply keeps the copied status');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE id = '33444444-4444-4444-8444-444444444444'),
    'draft', 'policy_mirror', 're-apply does not backfill over drift (only NULLs move)');
END $$;

-- ---------------------------------------------------------------------------
-- 95.6  CEILING. directus_app writes the three client columns (0013's grant
--        excludes id -- the default fills it) and reads the denorm, but
--        cannot spoof it (not in its column grant list). NOTE: the positive
--        write uses test_support.as_role, NOT a probe -- probe() rolls its
--        writes back by design, so a probe can never leave a row behind to
--        assert the trigger copy on (10_insert_contract precedent).
-- ---------------------------------------------------------------------------
SELECT test_support.as_role('directus_app',
  $q$INSERT INTO minutes_attendees (minute, person)
     SELECT '32555555-5555-4555-8555-555555555555',
            '00000000-0000-4000-8000-000000000095'
     WHERE NOT EXISTS (SELECT 1 FROM minutes_attendees
                        WHERE minute = '32555555-5555-4555-8555-555555555555'
                          AND person = '00000000-0000-4000-8000-000000000095')$q$);
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM minutes_attendees
      WHERE minute = '32555555-5555-4555-8555-555555555555'
        AND person = '00000000-0000-4000-8000-000000000095'),
    '1', 'policy_mirror', 'exactly one app-written probe row exists');
  PERFORM test_support.assert_equals(
    (SELECT minute_status FROM minutes_attendees
      WHERE minute = '32555555-5555-4555-8555-555555555555'
        AND person = '00000000-0000-4000-8000-000000000095'),
    'draft', 'policy_mirror', 'app-written row still gets the trigger copy');
  PERFORM test_support.assert_equals(
    (SELECT minute_created_by::text FROM minutes_attendees
      WHERE minute = '32555555-5555-4555-8555-555555555555'
        AND person = '00000000-0000-4000-8000-000000000095'),
    'a0000000-0000-4000-8000-000000000001', 'policy_mirror',
    'app-written row still gets the author copy');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO minutes_attendees (minute, person, minute_status)
       VALUES ('32555555-5555-4555-8555-555555555555',
               '00000000-0000-4000-8000-000000000095', 'draft')$q$,
    '42501', 'policy_mirror',
    'directus_app cannot write minute_status explicitly (spoofing fails closed)');
END $$;
