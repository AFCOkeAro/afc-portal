-- tests/db/88_attendance_sessions.sql
--
-- AFC-566 (parent AFC-460). THE ATTENDANCE SESSIONS + RECORDS REGISTER
-- CONTRACT.
--
-- Staging 500s on /api/attendance/* traced to the same class as AFC-550,
-- 0020 and 0021: the routes read attendance_sessions + attendance_records,
-- but no versioned migration created them (0002/0003/0010/0011/0013 touch
-- them only conditionally; 71's fixture stood in a scratch-only stand-in).
-- 0023 closes the gap, and 71's tripwire retires here: the fixture is gone,
-- the backfill runs against the real table. This suite pins what the
-- portal routes need from those tables.
--
--   88.1  shape         -- both tables exist with the columns the routes
--                           select (SESSION_FIELDS / record fields), the
--                           documented types, nullability and defaults.
--   88.2  enums         -- session_type outside the 11-key set and
--                           attendance_category outside member/visitor/
--                           child/other are rejected (23514); idempotency
--                           key unique; partial (session, person) unique.
--   88.3  links         -- record to a missing session fails (23503);
--                           session on a missing branch fails; record
--                           person SET NULLs (pinned via confdeltype);
--                           deleting a session CASCADES its records and its
--                           counts; the three §3 merge FKs exist.
--   88.4  overlap       -- re-applying 0002 + 0003 + 0010 + 0011 changes
--                           nothing: denorms and merge FKs are IF NOT EXISTS
--                           no-ops over 0023's tables (0013's re-apply is
--                           proven by suite 79).
--   88.5  guards        -- the app identity reads/inserts/updates
--                           operational columns and deletes nothing (42501
--                           on DELETE); validation rejects bad rows for the
--                           app too.
--   88.6  rerun         -- re-applying 20261020_0023 changes nothing.
--   88.7  empty rollback -- with no rows the down script drops both
--                           registers + the three merge FKs; the forward
--                           file is re-applied after.
--   88.8  acceptance    -- zero orphan records, zero orphan counts.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch scoping, capture idempotency 409, check-in dedupe, CSV shape --
-- lives in the route layer and is covered by
-- tests/web/attendance-split.contract.mjs. No retention probe: these
-- registers carry no retention clock; erasure runs as retention_worker.

-- ---------------------------------------------------------------------------
-- 88.1  SHAPE. Tables, columns, types, nullability, defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND to_regclass('public.attendance_records') IS NOT NULL, 'attendance',
    'attendance_sessions and attendance_records both exist (no more fixture)');

  -- Route-selected session columns (SESSION_FIELDS + capture writes).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
        AND column_name IN ('id', 'branch', 'zone', 'bsc', 'session_date',
          'session_type', 'session_name', 'service', 'event',
          'service_type_def', 'headcount_total', 'headcount_men',
          'headcount_women', 'headcount_children', 'headcount_adults',
          'headcount_youth', 'headcount_teens', 'headcount_visitors',
          'idempotency_key', 'recorded_by', 'recorded_at')) = 21, 'attendance',
    'attendance_sessions carries every column the routes select (21 incl. legacy five + idempotency key)');

  -- Route-selected record columns (detail + records.post).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_records'
        AND column_name IN ('id', 'session', 'person', 'attendee_name',
          'attendance_category', 'recorded_by', 'recorded_at')) = 7, 'attendance',
    'attendance_records carries every column the routes select (route-canonical names)');

  -- session_type is the route-canonical name (the fixture-era service_type
  -- is retired with the fixture in suite 71).
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
                   AND column_name = 'service_type'), 'attendance',
    'no service_type column: the fixture-era name retired with the fixture');

  -- idempotency_key is nullable UNIQUE (a second submit collides, not twins).
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
     AND column_name = 'idempotency_key';
  PERFORM test_support.assert_true(
    v_nullable = 'YES'
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attendance_sessions_idempotency_key_key'), 'attendance',
    'idempotency_key is nullable UNIQUE (capture 409 rests here)');

  -- Partial uniqueness: same person, same session, once.
  -- NOTE: pg_get_indexdef parenthesises the predicate
  -- (... WHERE (person IS NOT NULL)), so match the predicate, not the
  -- WHERE keyword.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'attendance_records'
               AND indexname = 'attendance_records_session_person_uidx'
               AND indexdef LIKE '%person IS NOT NULL%'), 'attendance',
    'partial UNIQUE (session, person) WHERE person IS NOT NULL (anonymous rows unconstrained)');
END $$;

-- ---------------------------------------------------------------------------
-- 88.2  ENUMS. Documented sets enforced at write; idempotency enforced.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO attendance_sessions (session_date, session_type) VALUES (DATE '2026-10-11', 'revival')$q$,
    '23514', 'attendance', 'an undocumented session_type is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO attendance_records (session, attendance_category) VALUES (gen_random_uuid(), 'ghost')$q$,
    '23514', 'attendance', 'an undocumented attendance_category is rejected');
  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO attendance_sessions (session_date, session_type) VALUES (DATE '2026-10-11', 'revival_service')$q$,
    'attendance', 'an 11-key session_type is accepted (probe, rolled back)');
END $$;

DO $$
DECLARE
  v_session uuid;
  v_person uuid;
BEGIN
  INSERT INTO attendance_sessions (session_date, session_type, idempotency_key)
    VALUES (DATE '2026-10-11', 'sunday_service', 'sess-88-probe')
  RETURNING id INTO v_session;
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO attendance_sessions (session_date, session_type, idempotency_key) VALUES (DATE ''2026-10-11'', ''sunday_service'', ''sess-88-probe'')',
    '23505', 'attendance', 'a replayed idempotency_key is refused (no twin session)');

  -- A real anchor row: people is retention-managed (DELETE refused even for
  -- the migrator, AFC-295), so the probe row stays -- an anchor with no
  -- PII, the 85-suite posture.
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person;
  INSERT INTO attendance_records (session, person) VALUES (v_session, v_person);
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO attendance_records (session, person) VALUES (''' || v_session::text || ''', ''' || v_person::text || ''')',
    '23505', 'attendance', 'the same person is not checked into one session twice');

  -- Two fully-anonymous rows do NOT collide (partial index, not table UNIQUE).
  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO attendance_records (session, attendee_name) VALUES (''' || v_session::text || ''', ''Walk-in One'')',
    'attendance', 'first anonymous check-in accepted (probe, cleaned below)');
  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO attendance_records (session, attendee_name) VALUES (''' || v_session::text || ''', ''Walk-in Two'')',
    'attendance', 'second anonymous check-in accepted (partial index only guards person rows)');

  DELETE FROM attendance_records WHERE session = v_session;
  DELETE FROM attendance_sessions WHERE id = v_session;
END $$;

-- ---------------------------------------------------------------------------
-- 88.3  LINKS. FKs fail closed; delete semantics per header choice 3.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_session uuid;
  v_orphan uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;

  -- Record on a missing session fails (23503), never silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO attendance_records (session) VALUES (''' || v_orphan::text || ''')',
    '23503', 'attendance', 'a record on a missing session is rejected');

  -- Session on a missing branch fails (stated choice 1: RESTRICT parent).
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO attendance_sessions (branch, session_date, session_type) VALUES (''' || v_orphan::text || ''', DATE ''2026-10-11'', ''sunday_service'')',
    '23503', 'attendance', 'a session on a missing branch is rejected');

  INSERT INTO attendance_sessions (branch, session_date, session_type, idempotency_key)
    VALUES (v_branch, DATE '2026-10-11', 'sunday_service', 'sess-88-links')
  RETURNING id INTO v_session;
  INSERT INTO attendance_records (session, attendee_name) VALUES (v_session, 'Link Check');
  INSERT INTO attendance_counts (session, category, sex, count)
    VALUES (v_session, 'adults', 'male', 7);

  -- Person link is SET NULL (pinned via the constraint definition -- people
  -- rows are retention-managed and cannot be deleted even by the migrator,
  -- so no live-fire delete here).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'attendance_records_person_fkey'
               AND confdeltype = 'n'), 'attendance',
    'record person FK is SET NULL (a person leaving never deletes the check-in)');

  -- Session delete CASCADES records and counts (facts about the session).
  DELETE FROM attendance_sessions WHERE id = v_session;
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM attendance_records WHERE session = v_session)
    AND NOT EXISTS (SELECT 1 FROM attendance_counts WHERE session = v_session), 'attendance',
    'deleting a session cascades its records and its split counts');

  -- The three §3 merge FKs are closed under their fixed names.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'attendance_counts_session_fkey' AND confdeltype = 'c'), 'attendance',
    'attendance_counts_session_fkey present: 0023 closed the 0003 merge (CASCADE)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_session_fkey'), 'attendance',
    'blessings_session_fkey present: 0023 closed the 0011 merge (fact survives, SET NULL)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_session_fkey'), 'attendance',
    'events_attendance_session_fkey present: 0023 closed the 0013 merge (corrections never destroy)');
END $$;

-- ---------------------------------------------------------------------------
-- 88.4  OVERLAP. Re-applying 0002 + 0003 + 0010 + 0011 changes nothing:
--        denorms and merge FKs are IF NOT EXISTS no-ops over 0023's tables
--        (0013's re-apply is proven by suite 79). CTO verdict on AFC-578
--        review: 0002 alone resurrects ABULE-EGBA, so the landed narrow
--        0024 is re-applied after it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql

\i services/directus/schema/migrations/20261020_0024_remove_abule_egba.sql
\i services/directus/schema/migrations/20261020_0029_remove_sango_ota_and_satellite.sql

\i services/directus/schema/migrations/20261020_0003_attendance_counts.sql

\i services/directus/schema/migrations/20261020_0010_sunday_services.sql

\i services/directus/schema/migrations/20261020_0011_blessings.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
               AND column_name IN ('zone', 'bsc', 'service_type_def'))
    AND to_regclass('public.attendance_sessions') IS NOT NULL
    AND to_regclass('public.attendance_records') IS NOT NULL, 'attendance',
    'overlap: zone/bsc/service_type_def ride the 0023 table (0002/0003 denorm no-ops)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_session_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_session_fkey'), 'attendance',
    'overlap: both merge FKs survive the 0010/0011 re-apply (fixed names agree)');
END $$;

-- ---------------------------------------------------------------------------
-- 88.5  GUARDS. The app reads/inserts/updates operational columns and
--        deletes nothing; validation rejects bad rows for the app too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_session uuid;
BEGIN
  INSERT INTO attendance_sessions (session_date, session_type)
    VALUES (DATE '2026-10-11', 'midweek') RETURNING id INTO v_session;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM attendance_sessions$q$,
    'attendance', 'app reads sessions');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM attendance_records$q$,
    'attendance', 'app reads name-level check-ins');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO attendance_records (session, attendee_name) VALUES ($q$ ||
      '''' || v_session::text || ''', ''Guard Walk-in'')',
    'attendance', 'app records a walk-in check-in (probe cleaned below)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE attendance_sessions SET headcount_total = headcount_total WHERE id IS NULL$q$,
    'attendance', 'app corrects session headers (UPDATE path, no delete)');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM attendance_sessions WHERE false$q$,
    '42501', 'attendance', 'app cannot DELETE sessions (audited facts)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM attendance_records WHERE false$q$,
    '42501', 'attendance', 'app cannot DELETE check-ins (trail survives)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO attendance_sessions (session_date, session_type) VALUES (DATE '2026-10-11', 'revival')$q$,
    '23514', 'attendance', 'a bad session_type is rejected for the app too');

  DELETE FROM attendance_records WHERE session = v_session;
  DELETE FROM attendance_sessions WHERE id = v_session;
END $$;

-- ---------------------------------------------------------------------------
-- 88.6  RERUN. Re-applying 20261020_0023 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0023_attendance_sessions.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND to_regclass('public.attendance_records') IS NOT NULL, 'attendance',
    'rerun: both tables present (IF NOT EXISTS, grants intact, seeds absent by design)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_sessions WHERE idempotency_key = 'sess-88-probe') = 0, 'attendance',
    'rerun: probe rows stayed cleaned (no invented attendance facts)');
END $$;

-- ---------------------------------------------------------------------------
-- 88.7  EMPTY ROLLBACK. No rows: the down script drops both registers and
--        the three merge FKs; the forward file is re-applied after.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM attendance_sessions) = 0
    AND (SELECT count(*) FROM attendance_records) = 0, 'attendance',
    'pre-rollback: empty registers (probes above cleaned up; 71 fixtures retired in 71.9)');
END $$;

-- 0034 links blessing_recipients to attendance_sessions/events; those FKs
-- would block the register drops below, so they are parked and re-added after.
ALTER TABLE blessing_recipients DROP CONSTRAINT IF EXISTS blessing_recipients_session_fkey;
ALTER TABLE blessing_recipients DROP CONSTRAINT IF EXISTS blessing_recipients_event_fkey;
\i services/directus/schema/migrations/rollback/20261020_0023_attendance_sessions.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NULL
    AND to_regclass('public.attendance_records') IS NULL, 'attendance',
    'empty-table rollback: both tables are gone');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_session_fkey')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_session_fkey')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_session_fkey'), 'attendance',
    'empty-table rollback: all three §3 merge FKs are gone with their referent');
END $$;

-- Leave the registers present, as the forward migration leaves them.
\i services/directus/schema/migrations/20261020_0023_attendance_sessions.sql

-- The register rollback above drops the 0030/0031 scope triggers; re-apply
-- them (and the 0034 links parked for the drops) so later suites see the
-- enforced tree.
\i services/directus/schema/migrations/20261020_0034_blessings_count_recipients.sql
\i services/directus/schema/migrations/20261020_0030_child_scope_denorm.sql
\i services/directus/schema/migrations/20261020_0031_fill_scope_zone.sql
\i services/directus/schema/migrations/20261022_0039_departments_fill_scope_drop.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NOT NULL
    AND to_regclass('public.attendance_records') IS NOT NULL, 'attendance',
    're-apply: sessions and records are back (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 88.8  ACCEPTANCE, as queries over the registers themselves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_records integer;
  v_orphan_counts integer;
BEGIN
  SELECT count(*) INTO v_orphan_records FROM attendance_records r
   WHERE NOT EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.id = r.session);
  PERFORM test_support.assert_true(v_orphan_records = 0, 'attendance',
    'ACCEPTANCE: zero orphan check-ins (session FK holds)');

  SELECT count(*) INTO v_orphan_counts FROM attendance_counts c
   WHERE NOT EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.id = c.session);
  PERFORM test_support.assert_true(v_orphan_counts = 0, 'attendance',
    'ACCEPTANCE: zero orphan split counts (0003 merge FK holds)');
END $$;
