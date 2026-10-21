-- tests/db/90_visitors_register.sql
--
-- AFC-583 (parent AFC-566, ancestor AFC-460). THE VISITORS REGISTER CONTRACT.
--
-- Staging 500s on /api/visitors/* traced to the same class as AFC-550,
-- 0020, 0021 and 0023: the routes read visitors (plus the 0008 journey
-- tables), but no versioned migration created the register (0008 touches
-- visitors only conditionally and states it never creates the table).
-- 0025 closes the gap -- the last gap-table row -- and suite 76's
-- visitors-absent pin retires here into a 0025-owned positive pin.
--
-- SUITE NUMBER NOTE (verified at authoring time): 89 is TAKEN
-- (tests/db/89_lagos_north_branches.sql, AFC-578, untracked in tree), so
-- this contract is 90, the next free number.
--
--   90.1  shape         -- visitors exists with the columns the routes
--                           select (the 25 JOURNEY_FIELDS), the documented
--                           types, nullability and defaults; the no-fork
--                           pins (no converted_person, no welfare_officer
--                           dup, no pack_id, no dormancy/consent engine).
--   90.2  enums         -- status / age_group / dropoff_outcome /
--                           last_contact_channel outside the documented
--                           sets are rejected at write (23514); blank
--                           names/notes rejected; email/phone shape is NOT
--                           SQL-checked (zod owns it, stated choice 4).
--   90.3  links         -- visitor on a missing branch fails (23503);
--                           person and journey_stage FKs are SET NULL
--                           (pinned via confdeltype); follow-up/transition
--                           on a missing visitor fail; deleting a visitor
--                           with care history is REFUSED (RESTRICT, live).
--   90.4  overlap       -- re-applying 0008 changes nothing except landing
--                           the two funnel views for the first time: deltas,
--                           CHECKs, FK and indexes are fixed-name no-ops;
--                           each fixed name exists exactly once.
--   90.5  guards        -- the app identity reads/inserts/updates
--                           operational columns and deletes nothing (42501
--                           on DELETE); validation rejects bad rows for the
--                           app too. No frozen columns: every operational
--                           column is UPDATEable by design (conversion,
--                           assignment and the journey writer all move
--                           through UPDATEs; corrections are UPDATEs).
--   90.6  rerun         -- re-applying 20261020_0025 changes nothing.
--   90.7  empty rollback -- with no rows and no trail the down script drops
--                           the register + the two audit-trail merge FKs +
--                           the funnel views; forward + 0008 re-applied after.
--   90.8  acceptance    -- zero orphan follow-ups/transitions; every row
--                           has names + visit_date; the funnel views read.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch scoping, capability gates, journey order/pack gates at the route,
-- convert idempotency, dedupe warnings, CSV shape -- lives in the route
-- layer and is covered by tests/web/visitor-journey.contract.mjs. No
-- retention probe: this register carries no retention clock; erasure runs
-- as retention_worker.

-- ---------------------------------------------------------------------------
-- 90.1  SHAPE. The register, the route columns, the defaults, the no-fork pins.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_default text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.visitors') IS NOT NULL, 'visitors',
    'visitors exists (no more conditional-only register)');

  -- Route-selected columns (JOURNEY_FIELDS in visitor-journey.ts: 15 base
  -- + 10 journey deltas).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visitors'
        AND column_name IN ('id', 'branch', 'visitor_first_name',
          'visitor_last_name', 'email', 'phone', 'visit_date', 'event',
          'age_group', 'invited_by', 'person', 'status', 'follow_up_owner',
          'next_follow_up_date', 'notes', 'journey_stage',
          'journey_stage_entered_at', 'journey_started_at', 'pack_checklist',
          'dropoff_outcome', 'dropoff_visited_at', 'next_check_in_at',
          'last_contact_at', 'last_contact_channel',
          'welfare_officer_assigned_at')) = 25, 'visitors',
    'visitors carries every column the routes select (15 base + 10 journey deltas)');

  -- follow_up_notes: the latest-summary field 0008 names as existing.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'visitors'
               AND column_name = 'follow_up_notes'), 'visitors',
    'visitors.follow_up_notes exists (Flow touch_contact summary field)');

  -- Route-required columns are NOT NULL (a row without names/date is not intake).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visitors'
        AND column_name IN ('visitor_first_name', 'visitor_last_name',
          'visit_date')
        AND is_nullable = 'NO') = 3, 'visitors',
    'names + visit_date are NOT NULL (the route never writes a nameless row)');

  -- Defaults the routes rely on (create posts partial payloads).
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'visitors'
     AND column_name = 'status';
  PERFORM test_support.assert_true(v_default LIKE '%new%', 'visitors',
    'visitors.status defaults new (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'visitors'
     AND column_name = 'age_group';
  PERFORM test_support.assert_true(v_default LIKE '%unknown%', 'visitors',
    'visitors.age_group defaults unknown (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'visitors'
     AND column_name = 'pack_checklist';
  PERFORM test_support.assert_true(v_default LIKE '%[]%', 'visitors',
    'visitors.pack_checklist defaults [] (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'visitors'
     AND column_name = 'dropoff_outcome';
  PERFORM test_support.assert_true(v_default LIKE '%pending%', 'visitors',
    'visitors.dropoff_outcome defaults pending (' || v_default || ')');

  -- No-fork pins: columns 0008 and the data model explicitly refuse.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'visitors'
                   AND column_name IN ('converted_person', 'welfare_officer',
                     'pack_id', 'dormancy_due_at')), 'visitors',
    'no fork columns: person stays the canonical link, follow_up_owner the single owner, pack/dormancy engines stay out');
END $$;

-- ---------------------------------------------------------------------------
-- 90.2  ENUMS. Documented sets enforced at write; blanks rejected.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, status) VALUES ('Ama', 'Okafor', DATE '2026-10-12', 'teleported')$q$,
    '23514', 'visitors', 'a status outside the live-portal five is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, age_group) VALUES ('Ama', 'Okafor', DATE '2026-10-12', 'elder')$q$,
    '23514', 'visitors', 'an undocumented age_group is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, dropoff_outcome) VALUES ('Ama', 'Okafor', DATE '2026-10-12', 'teleported')$q$,
    '23514', 'visitors', 'a dropoff_outcome outside the §2.1 enum is rejected (0008 fixed-name CHECK, closed by 0025)');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, last_contact_channel) VALUES ('Ama', 'Okafor', DATE '2026-10-12', 'pigeon')$q$,
    '23514', 'visitors', 'a channel outside the §2.1 enum is rejected (0008 fixed-name CHECK, closed by 0025)');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date) VALUES ('   ', 'Okafor', DATE '2026-10-12')$q$,
    '23514', 'visitors', 'a blank first name is rejected (NULL or real text, never whitespace)');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, notes) VALUES ('Ama', 'Okafor', DATE '2026-10-12', '   ')$q$,
    '23514', 'visitors', 'blank visitor notes are rejected (NULL or real text, never whitespace)');
  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, status, age_group) VALUES ('Ama', 'Okafor', DATE '2026-10-12', 'follow_up', 'adult')$q$,
    'visitors', 'a documented status + age_group is accepted (probe, rolled back)');
END $$;

-- ---------------------------------------------------------------------------
-- 90.3  LINKS. FKs fail closed; delete semantics per header choice 3.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_person uuid;
  v_stage uuid;
  v_visitor uuid;
  v_orphan uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;
  SELECT id INTO v_stage FROM visitor_journey_stages
   WHERE key = 'identify' AND branch IS NULL;

  -- Visitor on a missing branch fails (stated choice 1: RESTRICT parent).
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, branch) VALUES (''Ama'', ''Okafor'', DATE ''2026-10-12'', ''' || v_orphan::text || ''')',
    '23503', 'visitors', 'a visitor on a missing branch is rejected');

  -- Follow-up / transition on a missing visitor fail, never silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome) VALUES (''' || v_orphan::text || ''', ''visit'', ''reached'')',
    '23503', 'visitors', 'a follow-up on a missing visitor is rejected (0025 closed the 0008 §2 merge)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_orphan::text || ''', NULL, ''' || v_stage::text || ''')',
    '23503', 'visitors', 'a transition on a missing visitor is rejected (0025 closed the 0008 §3 merge)');

  -- A real anchor row: people is retention-managed (DELETE refused even for
  -- the migrator, AFC-295), so the probe row stays -- an anchor with no
  -- PII, the 85-suite posture.
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person;
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date,
      branch, person, journey_stage)
    VALUES ('Ama', 'Okafor', DATE '2026-10-12', v_branch, v_person, v_stage)
  RETURNING id INTO v_visitor;

  -- Person + journey_stage links are SET NULL (pinned via the constraint
  -- definition -- people rows cannot be deleted even by the migrator, so
  -- no live-fire delete here).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'visitors_person_fkey'
               AND confdeltype = 'n'), 'visitors',
    'visitors.person FK is SET NULL (a person correction never deletes the newcomer row)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'visitors_journey_stage_fkey'
               AND confdeltype = 'n'), 'visitors',
    'visitors.journey_stage FK is SET NULL (a stage reseed never deletes the newcomer row)');

  -- The two audit-trail FKs are RESTRICT (pinned via the definition).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'visitor_follow_ups_visitor_fkey'
               AND confdeltype = 'r'), 'visitors',
    'follow-up visitor FK is RESTRICT (the log is evidence, never cascaded away)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'visitor_journey_transitions_visitor_fkey'
               AND confdeltype = 'r'), 'visitors',
    'transition visitor FK is RESTRICT (the trail is evidence, never cascaded away)');

  -- Live-fire: a visitor with care history cannot be hard-deleted.
  -- (RESTRICT surfaces as 23503 foreign_key_violation, not 23000: the
  -- delete is refused by the FK, not by a RAISE.)
  INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome)
    VALUES (v_visitor, 'visit', 'reached');
  PERFORM test_support.assert_raises(NULL,
    'DELETE FROM visitors WHERE id = ''' || v_visitor::text || '''',
    '23503', 'visitors', 'deleting a visitor with follow-up history is refused (RESTRICT, live)');

  DELETE FROM visitor_follow_ups WHERE visitor = v_visitor;
  DELETE FROM visitors WHERE id = v_visitor;
END $$;

-- ---------------------------------------------------------------------------
-- 90.4  OVERLAP. Re-applying 0008 changes nothing except landing the two
--        funnel views for the first time: deltas, CHECKs, FK and indexes
--        are fixed-name no-ops. (Only 0008 touches visitors -- verified by
--        grep over services/directus/schema/migrations -- so it is the
--        only re-apply this section needs.)
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0008_visitor_journey.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'visitors_dropoff_outcome_valid') = 1, 'visitors',
    'overlap: exactly one dropoff CHECK (0025 shipped it, 0008 met it)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'visitors_last_contact_channel_valid') = 1, 'visitors',
    'overlap: exactly one channel CHECK (0025 shipped it, 0008 met it)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'visitors_journey_stage_fkey') = 1, 'visitors',
    'overlap: exactly one journey_stage FK (0025 closed it under the fixed name)');
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_funnel') IS NOT NULL
    AND to_regclass('public.visitor_follow_up_status') IS NOT NULL, 'visitors',
    'overlap: 0008 re-apply lands the funnel views now the host table exists (the documented scratch skip, closed)');
END $$;

-- ---------------------------------------------------------------------------
-- 90.5  GUARDS. The app reads/inserts/updates operational columns and
--        deletes nothing; validation rejects bad rows for the app too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_visitor uuid;
BEGIN
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date)
    VALUES ('Guard', 'Probe', DATE '2026-10-12') RETURNING id INTO v_visitor;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM visitors$q$,
    'visitors', 'app reads the register');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, status) VALUES ('App', 'Intake', DATE '2026-10-12', 'new')$q$,
    'visitors', 'app intakes a newcomer (probe cleaned below)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE visitors SET status = 'follow_up' WHERE visitor_first_name = 'App'$q$,
    'visitors', 'app advances a status (UPDATE path, no delete)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE visitors SET journey_stage_entered_at = now() WHERE visitor_first_name = 'App'$q$,
    'visitors', 'app stamps the journey deltas (UPDATE path, no delete)');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM visitors WHERE false$q$,
    '42501', 'visitors', 'app cannot DELETE newcomer rows (personal data incl. minors; erasure is retention_worker)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date, status) VALUES ('App', 'Bad', DATE '2026-10-12', 'teleported')$q$,
    '23514', 'visitors', 'a bad status is rejected for the app too');

  DELETE FROM visitors WHERE visitor_first_name IN ('Guard', 'App');
END $$;

-- ---------------------------------------------------------------------------
-- 90.6  RERUN. Re-applying 20261020_0025 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0025_visitors_register.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.visitors') IS NOT NULL, 'visitors',
    'rerun: the register is present (IF NOT EXISTS, grants intact, seeds absent by design)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitors
      WHERE visitor_first_name IN ('Guard', 'App')) = 0, 'visitors',
    'rerun: probe rows stayed cleaned (no invented newcomer facts)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('visitors_person_fkey',
        'visitor_follow_ups_visitor_fkey',
        'visitor_journey_transitions_visitor_fkey',
        'visitors_journey_stage_fkey')) = 4, 'visitors',
    'rerun: all four merge FKs present exactly once (conditional blocks are no-ops)');
END $$;

-- ---------------------------------------------------------------------------
-- 90.7  EMPTY ROLLBACK. No rows and no trail: the down script drops the
--        register + the two audit-trail merge FKs + the funnel views; the
--        forward file (+ 0008 for the views) is re-applied after.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitors) = 0
    AND (SELECT count(*) FROM visitor_follow_ups) = 0
    AND (SELECT count(*) FROM visitor_journey_transitions) = 0, 'visitors',
    'pre-rollback: empty register and empty trail (probes above cleaned up; 76 fixtures clean their own)');
END $$;

\i services/directus/schema/migrations/rollback/20261020_0025_visitors_register.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.visitors') IS NULL, 'visitors',
    'empty-table rollback: the register is gone');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname IN ('visitor_follow_ups_visitor_fkey',
                   'visitor_journey_transitions_visitor_fkey',
                   'visitors_person_fkey', 'visitors_journey_stage_fkey')), 'visitors',
    'empty-table rollback: all four merge FKs are gone with their referent');
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_funnel') IS NULL
    AND to_regclass('public.visitor_follow_up_status') IS NULL, 'visitors',
    'empty-table rollback: the funnel views are gone with their host table');
END $$;

-- Leave the register present, as the forward migration leaves it.
\i services/directus/schema/migrations/20261020_0025_visitors_register.sql

\i services/directus/schema/migrations/20261020_0008_visitor_journey.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.visitors') IS NOT NULL, 'visitors',
    're-apply: the register is back (idempotent forward)');
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_funnel') IS NOT NULL
    AND to_regclass('public.visitor_follow_up_status') IS NOT NULL, 'visitors',
    're-apply: 0008 restores the funnel views over the register');
END $$;

-- ---------------------------------------------------------------------------
-- 90.8  ACCEPTANCE, as queries over the register itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_follow integer;
  v_orphan_trans integer;
BEGIN
  SELECT count(*) INTO v_orphan_follow FROM visitor_follow_ups f
   WHERE NOT EXISTS (SELECT 1 FROM visitors v WHERE v.id = f.visitor);
  PERFORM test_support.assert_true(v_orphan_follow = 0, 'visitors',
    'ACCEPTANCE: zero orphan follow-ups (visitor FK holds)');

  SELECT count(*) INTO v_orphan_trans FROM visitor_journey_transitions t
   WHERE NOT EXISTS (SELECT 1 FROM visitors v WHERE v.id = t.visitor);
  PERFORM test_support.assert_true(v_orphan_trans = 0, 'visitors',
    'ACCEPTANCE: zero orphan transitions (visitor FK holds)');

  -- The funnel views read (empty register: zero rows, no error).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_funnel) = 0, 'visitors',
    'ACCEPTANCE: the funnel view reads over the register');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_follow_up_status) = 0, 'visitors',
    'ACCEPTANCE: the officer-status view reads over the register');
END $$;
