-- tests/db/83_invite_quota_slots.sql
--
-- AFC-516 / AFC-518 (ADR-0011). THE LEDGER-SLOT ATOMIC QUOTA CONTRACT.
--
-- FILE-NAME DEVIATION, STATED (issue text names 74_invite_quota_slots.sql):
--   tests/db/74_campaigns.sql already occupies 74 (nine seeded campaign keys,
--   Slice 4c). Overwriting it would destroy another slice's suite, so this
--   suite takes the next free number, 83. Internal section numbers below are
--   83.1-83.5; the suite label is 'quota'. The issue's 74.1-74.5 content is
--   otherwise covered point for point.
--
-- What this suite asserts (the half a replayed submit or a crafted request
-- cannot change):
--
--   83.1  schema         -- invite_quota_slots exists with the surrogate id
--                         PK (Directus single-column shape), the UNIQUE
--                         (inviter_user, period, period_start, slot_no) that
--                         IS the atomicity, the period + slot_no CHECKs, and
--                         the (inviter_user, period, period_start) index.
--   83.2  exhaustion     -- slots 0..9 for one (user,day) insert; slot 10
--                         with D=10 still inserts at SQL level (the limit is
--                         enforced by the writer protocol, not by a CHECK);
--                         a duplicate (user,day,slot) dies with 23505.
--   83.3  weekly grain   -- the week grain is independent of the day grain:
--                         same user, same date string, different period rows
--                         coexist; duplicates within the week grain die.
--   83.4  guards         -- directus_app INSERTs, SELECTs and DELETEs (the
--                         release path) and is refused (42501) on any UPDATE
--                         (slots are never mutated).
--   83.5  rerun          -- re-applying 20261020_0016 changes nothing
--                         (IF NOT EXISTS / conditional grants; row counts
--                         identical).
--
-- What this suite does NOT assert (stated, not missing): the writer protocol
-- itself -- Lagos day/week keys, claim-then-release, the claim as the
-- authoritative verdict over the count pre-check -- lives in the route layer
-- (apps/web/server/utils/event-invites.ts) and is covered by the web contract
-- test plus the PGlite concurrency proof
-- (tests/web/invite-quota-concurrency.contract.mjs). A SQL suite asserting
-- HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 83.1  SCHEMA. The ledger, the single-winner UNIQUE, the CHECKs, the index.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.invite_quota_slots') IS NOT NULL, 'quota',
    'invite_quota_slots exists');

  -- Surrogate single-column PK for the Directus /items/:id shape.
  PERFORM test_support.assert_true(
    EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.invite_quota_slots'::regclass
         AND contype = 'p'
    ), 'quota',
    'invite_quota_slots has a primary key');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.invite_quota_slots'::regclass
        AND contype = 'p') = 1, 'quota',
    'exactly one primary key (the surrogate id, not a composite)');

  -- THIS is the atomicity: one winner per (user, period, window, slot).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'invite_quota_slots_one_winner_per_slot'), 'quota',
    'the single-winner UNIQUE (inviter_user, period, period_start, slot_no) exists');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'invite_quota_slots'
               AND indexname = 'invite_quota_slots_window_idx'), 'quota',
    'the (inviter_user, period, period_start) window index exists');

  -- Bad period rejected at write.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES (gen_random_uuid(), 'month', '2026-10-20', 0)$q$,
    '23514', 'quota', 'a period outside (day, week) is rejected');

  -- Negative slot rejected at write.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES (gen_random_uuid(), 'day', '2026-10-20', -1)$q$,
    '23514', 'quota', 'a negative slot_no is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 83.2  EXHAUSTION. Ten slots insert; the eleventh is the writer's stop sign,
-- not the database's -- and a duplicate slot dies with 23505.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  s integer;
BEGIN
  FOR s IN 0..9 LOOP
    INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
    VALUES (v_user, 'day', '2026-10-20', s);
  END LOOP;

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM invite_quota_slots
      WHERE inviter_user = v_user AND period = 'day'
        AND period_start = '2026-10-20') = 10, 'quota',
    'slots 0..9 for one (user,day) all insert (found 10)');

  -- Slot 10 with D=10 succeeds at SQL level: the LIMIT lives in the writer
  -- protocol (claim 0..D-1), not in a CHECK. The database serializes; the
  -- writer decides how many slots exist.
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES (v_user, 'day', '2026-10-20', 10);
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM invite_quota_slots
      WHERE inviter_user = v_user AND period = 'day'
        AND period_start = '2026-10-20') = 11, 'quota',
    'slot 10 inserts at SQL level (the D=10 bound is the writer protocol, not a CHECK)');

  -- The atomicity itself: the same slot twice is exactly one winner.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES (''' || v_user::text || ''', ''day'', ''2026-10-20'', 3)',
    '23505', 'quota', 'a duplicate (user,day,slot) raises unique_violation (23505)');

  DELETE FROM invite_quota_slots WHERE inviter_user = v_user;
END $$;

-- ---------------------------------------------------------------------------
-- 83.3  WEEKLY GRAIN. Independent of the daily grain; unique within itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES (v_user, 'day', '2026-10-20', 0);
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES (v_user, 'week', '2026-10-19', 0);

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM invite_quota_slots WHERE inviter_user = v_user) = 2, 'quota',
    'same user holds a day slot and a week slot side by side (grains are independent)');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES (''' || v_user::text || ''', ''week'', ''2026-10-19'', 0)',
    '23505', 'quota', 'a duplicate (user,week,slot) raises unique_violation (23505)');

  -- A different Monday is a different window, not a conflict.
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES (v_user, 'week', '2026-10-26', 0);
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM invite_quota_slots
      WHERE inviter_user = v_user AND period = 'week') = 2, 'quota',
    'the next Monday is a fresh week window (2 week rows)');

  DELETE FROM invite_quota_slots WHERE inviter_user = v_user;
END $$;

-- ---------------------------------------------------------------------------
-- 83.4  GUARDS. The app identity claims, reads and releases -- never mutates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_slot uuid;
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES (''' || v_user::text || ''', ''day'', ''2026-10-20'', 0)',
    'quota', 'directus_app INSERTs a claimed slot (probe, rolled back)');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM invite_quota_slots$q$,
    'quota', 'directus_app SELECTs the ledger');

  -- A real row for the mutation probes below (probe rolls its own writes
  -- back, so the fixture is written persistently first).
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES (v_user, 'day', '2026-10-20', 1)
  RETURNING id INTO v_slot;

  PERFORM test_support.assert_raises('directus_app',
    'UPDATE invite_quota_slots SET slot_no = 7 WHERE id = ''' || v_slot::text || '''',
    '42501', 'quota', 'directus_app cannot UPDATE a slot (slots are never mutated)');
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE invite_quota_slots SET period_start = ''2026-10-21'' WHERE id = ''' || v_slot::text || '''',
    '42501', 'quota', 'directus_app cannot rewrite a slot window');

  -- The release path: DELETE of the attempt's own claimed row.
  PERFORM test_support.assert_not_raises('directus_app',
    'DELETE FROM invite_quota_slots WHERE id = ''' || v_slot::text || '''',
    'quota', 'directus_app DELETEs a claimed slot (release path, probe rolled back)');

  DELETE FROM invite_quota_slots WHERE inviter_user = v_user;
END $$;

-- ---------------------------------------------------------------------------
-- 83.5  RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0016_invite_quota_slots.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.invite_quota_slots') IS NOT NULL, 'quota',
    'rerun: invite_quota_slots still exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'invite_quota_slots_one_winner_per_slot'), 'quota',
    'rerun: the single-winner UNIQUE still present (idempotent re-apply)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM invite_quota_slots) = 0, 'quota',
    'rerun: the suite cleaned its rows and the migration seeds none');
END $$;
