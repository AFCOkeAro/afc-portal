-- tests/db/84_event_group_code.sql
--
-- AFC-519 (CTO decision on AFC-493 option A, parent AFC-470). THE GROUP-CODE
-- PERSISTENCE CONTRACT.
--
-- POST /api/events/[id]/group-registrations validates one group_code per
-- group submission. Storing the code on the rows is required so group rows
-- are queryable per submission (S4 group-record page, US-G3) and so the
-- idempotency key has stored ground truth.
--
-- What this suite asserts:
--
--   84.1  host fixture   -- event_registrations is owned by the
--                           registrations-owning slice and is absent from
--                           the scratch DB, so the forward migration skips
--                           loudly there (0002 §10 / 0005 pattern). This
--                           suite stands up a MINIMAL stub (id + event only)
--                           to exercise the conditional path, then re-applies
--                           the real migration. The stub is dropped at the
--                           end, restoring the tree as found -- it never
--                           forks the owning slice's table.
--   84.2  schema         -- group_code exists, is nullable text, the
--                           event_registrations_group_code_len CHECK exists,
--                           and the (event, group_code) index exists.
--   84.3  length gate    -- a 65-char code is rejected at creation (23514);
--                           a 64-char code and NULL are accepted.
--   84.4  empty rollback -- with no stored codes, the down script drops the
--                           index + column cleanly; the forward file is then
--                           re-applied so the suite leaves the column present.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- route validation, meta echo, idempotency split -- lives in the route
-- layer and is covered by tests/web/event-registration-completion.contract.mjs.
-- No permission probe: the migration issues no GRANT/REVOKE (group_code is
-- a staff-chosen operational label, not PII; the Directus role matrix is
-- untouched), so there is no new ceiling to pin.

-- ---------------------------------------------------------------------------
-- 84.1  HOST FIXTURE. A minimal stub where the owning slice has not landed.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.event_registrations') IS NULL THEN
    CREATE TABLE event_registrations (
      id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event uuid
    );
    RAISE NOTICE '84.1: event_registrations absent -- minimal test stub (id, event) created. The owning slice replaces, never merges with, this stub; it is dropped at the end of this suite.';
  ELSE
    RAISE NOTICE '84.1: event_registrations present -- exercising the real table, no stub needed.';
  END IF;
END $$;

-- The conditional path, applied for real (rerunnable: IF NOT EXISTS).
\i services/directus/schema/migrations/20261020_0017_event_group_code.sql

-- ---------------------------------------------------------------------------
-- 84.2  SCHEMA. The column, its nullability, the CHECK, the index.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'event_registrations'
               AND column_name = 'group_code'), 'groupcode',
    'group_code exists on event_registrations');

  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'event_registrations'
     AND column_name = 'group_code';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'groupcode',
    'group_code is nullable (no backfill, pre-existing rows stay NULL)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'event_registrations'
               AND column_name = 'group_code'
               AND data_type = 'text'), 'groupcode',
    'group_code is text');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_registrations_group_code_len'), 'groupcode',
    'the <=64-char CHECK event_registrations_group_code_len exists');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'event_registrations'
               AND indexname = 'event_registrations_event_group_code_idx'), 'groupcode',
    'the (event, group_code) index exists');
END $$;

-- ---------------------------------------------------------------------------
-- 84.3  LENGTH GATE. 65 chars rejected, 64 chars and NULL accepted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_long text := repeat('g', 65);
  v_max text := repeat('g', 64);
BEGIN
  -- AFC-566: 0021 created the real registers (event FK enforced, names NOT
  -- NULL), so the probes run against a real throwaway event row created
  -- here and removed in 84.5 -- the stub shape this suite stood up
  -- pre-0021 needed neither. CHECK order is unchanged: the long code still
  -- fails 23514, valid codes still pass.
  IF to_regclass('public.events') IS NOT NULL THEN
    INSERT INTO events (title, start_at, end_at)
      VALUES ('Groupcode Probe Event', now(), now()) RETURNING id INTO v_event;
  ELSE
    v_event := gen_random_uuid();
  END IF;
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, group_code) VALUES (''' || v_event::text || ''', ''Long'', ''Code'', ''' || v_long || ''')',
    '23514', 'groupcode', 'a 65-char group_code is rejected at creation');

  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, group_code) VALUES (''' || v_event::text || ''', ''Max'', ''Code'', ''' || v_max || ''')',
    'groupcode', 'a 64-char group_code is accepted (probe, rolled back)');

  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, group_code) VALUES (''' || v_event::text || ''', ''Null'', ''Code'', NULL)',
    'groupcode', 'NULL group_code is accepted -- pre-existing rows stay NULL (probe, rolled back)');
END $$;

-- ---------------------------------------------------------------------------
-- 84.4  EMPTY-TABLE ROLLBACK. No stored codes: the down script drops the
--        index + column cleanly; the forward file is re-applied after.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_registrations WHERE group_code IS NOT NULL) = 0, 'groupcode',
    'pre-rollback: no stored group codes (probes above rolled back)');
END $$;

\i services/directus/schema/migrations/rollback/20261020_0017_event_group_code.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'event_registrations'
                   AND column_name = 'group_code'), 'groupcode',
    'empty-table rollback: group_code is gone');

  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public'
                   AND tablename = 'event_registrations'
                   AND indexname = 'event_registrations_event_group_code_idx'), 'groupcode',
    'empty-table rollback: the (event, group_code) index is gone');
END $$;

-- Leave the column present, as the forward migration leaves it.
\i services/directus/schema/migrations/20261020_0017_event_group_code.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'event_registrations'
               AND column_name = 'group_code'), 'groupcode',
    're-apply: group_code is back (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 84.5  RESTORE THE TREE. If 84.1 stood up the minimal stub, drop it: the
--        owning slice's CREATE must meet an absent table, never a stub that
--        silently wins an IF NOT EXISTS. A real table (more columns than
--        the stub shape) is left in place with the column present.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cols text[];
BEGIN
  IF to_regclass('public.event_registrations') IS NULL THEN
    RAISE NOTICE '84.5: event_registrations absent -- nothing to restore.';
    RETURN;
  END IF;

  SELECT coalesce(array_agg(column_name ORDER BY column_name), '{}') INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'event_registrations';

  IF v_cols = ARRAY['event', 'group_code', 'id'] THEN
    DROP TABLE event_registrations;
    RAISE NOTICE '84.5: minimal stub dropped -- tree restored as found (table absent).';
  ELSE
    RAISE NOTICE '84.5: real event_registrations present -- left in place with group_code.';
  END IF;

  -- AFC-566: remove 84.3's throwaway event row (probes roll back; only the
  -- event row persists). 84.4's rollback test already ran, so the drop is
  -- safe here; registrations cascade with nothing to cascade (empty).
  DELETE FROM events WHERE title = 'Groupcode Probe Event';
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM events WHERE title = 'Groupcode Probe Event') = 0, 'groupcode',
    'restore: 84.3 throwaway event removed (tree as found)');
END $$;
