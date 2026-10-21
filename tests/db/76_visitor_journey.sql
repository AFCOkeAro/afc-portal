-- tests/db/76_visitor_journey.sql
--
-- AFC-471 / AFC-462 (Slice 2c). THE NEWCOMER JOURNEY CONTRACT.
--
-- Newcomer journey (data-model-v4 §2): seedable visitor_journey_stages,
-- journey fields on visitors (conditional -- the table is Directus-owned),
-- visitor_follow_ups outcome log, transition audit with a forward-one-step
-- guard, funnel views (conditional), conversion via visitors.person.
--
--   76.1  schema         -- the three tables with every §2 field that this
--                         slice owns and the §6 indexes; the five seeded
--                         stages with sequences 1-5; the four pure gates;
--                         the guard trigger; the visitors register is
--                         0025-owned WITH the journey deltas (the absent-pin
--                         retired in AFC-583 -- 0002 §10 pattern met a real
--                         register, same as suite 73.1).
--   76.2  order guard    -- the trigger: initial capture must land on
--                         sequence 1; then exactly one step forward; skips,
--                         repeats and backward moves raise check_violation;
--                         unknown stages raise. Pack/drop-off gates are
--                         skipped in scratch (no visitors table to read) and
--                         are pinned as pure functions in 76.3 instead.
--   76.3  pure gates     -- journey_can_advance() matrix (NULL->1 true,
--                         n->n+1 true, everything else false, NULL target
--                         raises); journey_pack_complete() (full checklist
--                         true, missing item false, non-array false, empty
--                         required true); journey_dropoff_complete()
--                         (recorded outcomes true, pending/NULL/blank false);
--                         journey_required_pack_items() (the six board keys).
--   76.4  follow-ups     -- every §2.7 outcome inserts; anything outside the
--                         enum does not; blank notes rejected.
--   76.5  acceptance     -- THE ISSUE ACCEPTANCE, as queries: journeys are
--                         ordered (a full identify->follow_up walk leaves five
--                         audit rows in sequence order) and auditable (every
--                         row stamps entered_at); the funnel/officer report
--                         inputs exist (stages + transitions + follow-ups are
--                         all queryable per visitor).
--   76.6  guards         -- the app identity reads stages, inserts follow-up
--                         and transition rows, and is refused (42501) on
--                         frozen-column rewrites, on audit UPDATEs, and on
--                         any DELETE.
--   76.7  rerun          -- re-applying 20261020_0008 changes nothing
--                         (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO
--                         NOTHING / conditional blocks; stage, function and
--                         index counts identical, seed not duplicated).
--
-- What this suite does NOT assert (stated, not missing):
--   the status-enum rename (NOT done -- the live portal keeps
--     new/follow_up/converted/closed/declined; see the 0008 header), the
--     officer-position check (leadership_positions is not in schema history;
--     the Flow + route own it), duplicate-warning + idempotent convert
--     (HTTP layer, covered by the web contract test -- a SQL suite
--     asserting HTTP status codes would be testing the wrong layer), and
--     the funnel numbers themselves (the route folds loaded rows; the
--     views land on the 0008 re-apply now that 0025 owns the host table,
--     pinned by suite 90.4).

-- ---------------------------------------------------------------------------
-- 76.1  SCHEMA. The tables, the seed, the gates, the guard.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_idx integer;
  v_seq text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_journey_stages') IS NOT NULL, 'journey',
    'visitor_journey_stages exists');
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_follow_ups') IS NOT NULL, 'journey',
    'visitor_follow_ups exists');
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_journey_transitions') IS NOT NULL, 'journey',
    'visitor_journey_transitions exists');

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'visitor_follow_ups';
  PERFORM test_support.assert_true(v_idx >= 4, 'journey',
    'visitor_follow_ups carries the §6 index set (found ' || v_idx::text || ')');

  -- The five seeded stages, in order, with the §2.2 flags.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_journey_stages WHERE branch IS NULL) = 5, 'journey',
    'five global stages seeded');
  SELECT string_agg(key, ',' ORDER BY sequence) INTO v_seq
    FROM (SELECT key, sequence FROM visitor_journey_stages WHERE branch IS NULL) s;
  PERFORM test_support.assert_equals(
    'identify,welcome,pack,dropoff,follow_up', COALESCE(v_seq, ''), 'journey',
    'seed order is identify -> welcome -> pack -> dropoff -> follow_up');
  PERFORM test_support.assert_true(
    (SELECT requires_pack FROM visitor_journey_stages WHERE key = 'pack' AND branch IS NULL) = true
    AND (SELECT requires_visit_outcome FROM visitor_journey_stages WHERE key = 'dropoff' AND branch IS NULL) = true
    AND (SELECT target_days FROM visitor_journey_stages WHERE key = 'follow_up' AND branch IS NULL) = 60, 'journey',
    'pack requires the checklist, drop-off requires an outcome, follow-up SLA is 60 days');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'journey_can_advance'), 'journey',
    'journey_can_advance() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'journey_pack_complete'), 'journey',
    'journey_pack_complete() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'journey_dropoff_complete'), 'journey',
    'journey_dropoff_complete() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'journey_required_pack_items'), 'journey',
    'journey_required_pack_items() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'journey_transition_guard_trg'), 'journey',
    'the sequence-guard trigger is installed on the transitions table');

  -- AFC-583: visitors is no longer absent -- 20261020_0025 created the
  -- register WITH the 0008 journey deltas. The no-fork invariant is now
  -- pinned positively: the table present carries the owning migration's
  -- full shape (route columns 0008 would never create, e.g.
  -- visitor_first_name/status/visit_date, alongside the delta columns),
  -- so 0008's conditional ALTERs met a real register, never a fork of
  -- their own making.
  PERFORM test_support.assert_true(
    to_regclass('public.visitors') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'visitors'
                   AND column_name = 'visitor_first_name')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'visitors'
                   AND column_name = 'status')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'visitors'
                   AND column_name = 'pack_checklist')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'visitors'
                   AND column_name = 'dropoff_outcome'),
    'journey', 'visitors is 0025-owned with base + journey-delta shape (0008 met it, never forked it)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'visitors_journey_stage_fkey') = 1,
    'journey', 'visitors.journey_stage FK exists exactly once under the fixed name (0008 conditional met the 0025 register)');
END $$;

-- Every §2.7 outcome inserts; anything outside the enum does not.
DO $$
DECLARE
  o text;
  v_anchor uuid;
BEGIN
  -- AFC-583: the 0025 register is real, so the 0008 §2 merge FK holds --
  -- outcome rows need a real visitor (the AFC-566/79-fixture posture: a
  -- no-PII anchor row, cleaned below).
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date)
    VALUES ('Journey', 'Anchor-One', DATE '2026-10-05')
  RETURNING id INTO v_anchor;

  FOREACH o IN ARRAY ARRAY['reached', 'no_answer', 'requested_visit',
      'needs_support', 'declined', 'moved', 'wrong_number', 'integrated']
  LOOP
    INSERT INTO visitor_follow_ups
      (visitor, contact_channel, outcome, logged_by)
    VALUES
      (v_anchor, 'visit', o, gen_random_uuid());
  END LOOP;

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_follow_ups WHERE logged_by IS NOT NULL) = 8, 'journey',
    'all eight §2.7 outcomes insert');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome) VALUES (''' || v_anchor::text || ''', ''visit'', ''teleported'')',
    '23514', 'journey', 'an outcome outside the §2.7 enum is rejected');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome) VALUES (''' || v_anchor::text || ''', ''pigeon'', ''reached'')',
    '23514', 'journey', 'a channel outside the §2.7 enum is rejected');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome, notes) VALUES (''' || v_anchor::text || ''', ''visit'', ''reached'', ''   '')',
    '23514', 'journey', 'blank follow-up notes are rejected (NULL or real text, never whitespace)');

  DELETE FROM visitor_follow_ups;
  DELETE FROM visitors WHERE id = v_anchor;
END $$;

-- ---------------------------------------------------------------------------
-- 76.2  ORDER GUARD. One step forward, from the right start, or rejected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_identify uuid; v_welcome uuid; v_pack uuid; v_dropoff uuid; v_follow uuid;
  v_visitor uuid;
BEGIN
  -- AFC-583: anchor newcomer (0025 register real; the §3 merge FK holds).
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date)
    VALUES ('Journey', 'Anchor-Two', DATE '2026-10-05')
  RETURNING id INTO v_visitor;
  SELECT id INTO v_identify FROM visitor_journey_stages WHERE key = 'identify' AND branch IS NULL;
  SELECT id INTO v_welcome FROM visitor_journey_stages WHERE key = 'welcome' AND branch IS NULL;
  SELECT id INTO v_pack FROM visitor_journey_stages WHERE key = 'pack' AND branch IS NULL;
  SELECT id INTO v_dropoff FROM visitor_journey_stages WHERE key = 'dropoff' AND branch IS NULL;
  SELECT id INTO v_follow FROM visitor_journey_stages WHERE key = 'follow_up' AND branch IS NULL;

  -- Initial capture must land on sequence 1.
  INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage)
  VALUES (v_visitor, NULL, v_identify);
  PERFORM test_support.assert_true(true, 'journey',
    'initial capture onto identify (sequence 1) is accepted');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_visitor || ''', NULL, ''' || v_welcome || ''')',
    '23514', 'journey', 'initial capture onto welcome (sequence 2) is rejected -- no skipping the start');

  -- One step forward is accepted; skips, repeats and backward moves are not.
  INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage)
  VALUES (v_visitor, v_identify, v_welcome);
  PERFORM test_support.assert_true(true, 'journey',
    'identify -> welcome (one step) is accepted');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_visitor || ''', ''' || v_welcome || ''', ''' || v_dropoff || ''')',
    '23514', 'journey', 'welcome -> dropoff is rejected (a skip, even though both exist)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_visitor || ''', ''' || v_welcome || ''', ''' || v_welcome || ''')',
    '23514', 'journey', 'welcome -> welcome (a repeat) is rejected');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_visitor || ''', ''' || v_welcome || ''', ''' || v_identify || ''')',
    '23514', 'journey', 'welcome -> identify (backward) is rejected');

  -- Unknown stages raise rather than passing silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_visitor || ''', ''' || v_welcome || ''', ''' || gen_random_uuid() || ''')',
    '23514', 'journey', 'a move onto a stage that does not exist is rejected');

  DELETE FROM visitor_journey_transitions WHERE visitor = v_visitor;
  DELETE FROM visitors WHERE id = v_visitor;
END $$;

-- ---------------------------------------------------------------------------
-- 76.3  PURE GATES. The rule the Flow and the route share, pinned directly.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    journey_can_advance(NULL, 1) = true, 'journey',
    'initial capture onto sequence 1 advances');
  PERFORM test_support.assert_true(
    journey_can_advance(NULL, 2) = false, 'journey',
    'initial capture onto sequence 2 does not advance');
  PERFORM test_support.assert_true(
    journey_can_advance(1, 2) = true
    AND journey_can_advance(3, 4) = true
    AND journey_can_advance(4, 5) = true, 'journey',
    'each forward step of one advances');
  PERFORM test_support.assert_true(
    journey_can_advance(2, 2) = false
    AND journey_can_advance(2, 4) = false
    AND journey_can_advance(3, 1) = false
    AND journey_can_advance(5, 6) = true, 'journey',
    'repeats, skips and backward moves do not advance (past the last seed is still +1)');
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT journey_can_advance(1, NULL)$q$,
    '23514', 'journey', 'NULL target raises rather than guessing');

  PERFORM test_support.assert_true(
    journey_pack_complete('["literature","sermon_notes","gift_bag","malt","biscuits","contact_card"]'::jsonb,
                          journey_required_pack_items()) = true, 'journey',
    'a full six-item checklist satisfies the pack gate');
  PERFORM test_support.assert_true(
    journey_pack_complete('["literature","sermon_notes","gift_bag","malt","biscuits"]'::jsonb,
                          journey_required_pack_items()) = false, 'journey',
    'a checklist missing the contact card does not satisfy the pack gate');
  PERFORM test_support.assert_true(
    journey_pack_complete(NULL, journey_required_pack_items()) = false, 'journey',
    'no checklist does not satisfy the pack gate');
  PERFORM test_support.assert_true(
    journey_pack_complete('{"literature": true}'::jsonb, journey_required_pack_items()) = false, 'journey',
    'a non-array checklist does not satisfy the pack gate');
  PERFORM test_support.assert_true(
    journey_pack_complete('[]'::jsonb, NULL) = true, 'journey',
    'an empty required set asks nothing (Slice 4 back-compat)');

  PERFORM test_support.assert_true(
    journey_dropoff_complete('address_confirmed') = true
    AND journey_dropoff_complete('moved') = true
    AND journey_dropoff_complete('not_home') = true
    AND journey_dropoff_complete('declined') = true
    AND journey_dropoff_complete('wrong_number') = true, 'journey',
    'every recorded drop-off outcome satisfies the gate');
  PERFORM test_support.assert_true(
    journey_dropoff_complete('pending') = false
    AND journey_dropoff_complete(NULL) = false
    AND journey_dropoff_complete('  ') = false, 'journey',
    'pending, NULL and blank outcomes do not satisfy the gate');

  PERFORM test_support.assert_true(
    journey_required_pack_items() =
      ARRAY['literature', 'sermon_notes', 'gift_bag', 'malt', 'biscuits', 'contact_card'], 'journey',
    'the required pack list is the six board keys (§2.3 seed)');
END $$;

-- ---------------------------------------------------------------------------
-- 76.4  ACCEPTANCE. Ordered, auditable, reportable -- as queries.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ids uuid[];
  v_visitor uuid;
  v_rows integer;
  v_stamped integer;
BEGIN
  -- AFC-583: anchor newcomer (0025 register real; the §3 merge FK holds).
  -- Pre-seeded with a complete pack checklist and a recorded drop-off
  -- outcome: now that the register exists, the guard enforces the
  -- pack/drop-off gates on the walk (0008 design -- the gates were
  -- skipped, not absent, while there was no row to read). The walk below
  -- pins ordering/audit; the gates themselves are pinned in 76.2/76.3.
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date,
      pack_checklist, dropoff_outcome)
    VALUES ('Journey', 'Anchor-Three', DATE '2026-10-05',
      '["literature","sermon_notes","gift_bag","malt","biscuits","contact_card"]'::jsonb,
      'address_confirmed')
  RETURNING id INTO v_visitor;
  SELECT array_agg(id ORDER BY sequence) INTO v_ids
    FROM visitor_journey_stages WHERE branch IS NULL;

  -- Walk the whole journey one step at a time, exactly as the route must.
  INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage)
  VALUES (v_visitor, NULL, v_ids[1]),
         (v_visitor, v_ids[1], v_ids[2]),
         (v_visitor, v_ids[2], v_ids[3]),
         (v_visitor, v_ids[3], v_ids[4]),
         (v_visitor, v_ids[4], v_ids[5]);

  SELECT count(*) INTO v_rows FROM visitor_journey_transitions
   WHERE visitor = v_visitor;
  PERFORM test_support.assert_true(v_rows = 5, 'journey',
    'ACCEPTANCE: a full journey walk leaves five audit rows (found ' || v_rows::text || ')');

  SELECT count(*) INTO v_stamped FROM visitor_journey_transitions
   WHERE visitor = v_visitor AND entered_at IS NOT NULL;
  PERFORM test_support.assert_true(v_stamped = 5, 'journey',
    'ACCEPTANCE: every transition stamps entered_at');

  -- The funnel/officer report inputs are all queryable per visitor.
  INSERT INTO visitor_follow_ups
    (visitor, branch, contact_channel, outcome, next_step, next_follow_up_at, logged_by)
  VALUES
    (v_visitor, gen_random_uuid(), 'phone', 'reached', 'Visit Sunday', CURRENT_DATE + 7, gen_random_uuid()),
    (v_visitor, gen_random_uuid(), 'visit', 'needs_support', 'Open welfare case', CURRENT_DATE + 2, gen_random_uuid());

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_follow_ups WHERE visitor = v_visitor) = 2, 'journey',
    'ACCEPTANCE: the follow-up timeline for a visitor reads back in full');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM visitor_follow_ups WHERE visitor = v_visitor AND outcome = 'needs_support'), 'journey',
    'ACCEPTANCE: a needs_support outcome is on the log, offering the welfare-case link');

  DELETE FROM visitor_follow_ups WHERE visitor = v_visitor;
  DELETE FROM visitor_journey_transitions WHERE visitor = v_visitor;
  DELETE FROM visitors WHERE id = v_visitor;
END $$;

-- ---------------------------------------------------------------------------
-- 76.5  GUARDS. The app identity inserts the resolved rows and reads them --
-- and nothing else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_anchor uuid;
BEGIN
  -- AFC-583: anchor newcomer for the app-identity inserts below (0025
  -- register real; the §§2-3 merge FKs hold for directus_app too).
  INSERT INTO visitors (visitor_first_name, visitor_last_name, visit_date)
    VALUES ('Journey', 'Anchor-Four', DATE '2026-10-05')
  RETURNING id INTO v_anchor;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM visitor_journey_stages$q$,
    'journey', 'directus_app reads the stage reference');

  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO visitor_follow_ups (visitor, contact_channel, outcome, next_step) VALUES (''' || v_anchor::text || ''', ''sms'', ''no_answer'', ''Call again'')',
    'journey', 'directus_app inserts a follow-up row');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE visitor_follow_ups SET next_step = 'Call Sunday' WHERE next_step = 'Call again'$q$,
    'journey', 'directus_app advances next_step on a follow-up');
  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO visitor_journey_transitions (visitor, from_stage, to_stage) VALUES (''' || v_anchor::text || ''', NULL, (SELECT id FROM visitor_journey_stages WHERE key = ''identify'' AND branch IS NULL LIMIT 1))',
    'journey', 'directus_app inserts the initial-capture audit row');

  -- Frozen columns: a correction is a new row, not an edit.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE visitor_follow_ups SET outcome = 'reached' WHERE next_step = 'Call Sunday'$q$,
    '42501', 'journey', 'directus_app cannot rewrite a recorded outcome');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE visitor_follow_ups SET notes = 'edited' WHERE next_step = 'Call Sunday'$q$,
    '42501', 'journey', 'directus_app cannot rewrite restricted notes');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE visitor_follow_ups SET contact_channel = 'visit' WHERE next_step = 'Call Sunday'$q$,
    '42501', 'journey', 'directus_app cannot rewrite the contact channel');

  -- The audit trail is immutable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE visitor_journey_transitions SET note = 'edited'$q$,
    '42501', 'journey', 'directus_app cannot rewrite transition audit rows');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM visitor_journey_transitions$q$,
    '42501', 'journey', 'directus_app cannot delete transition audit rows');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM visitor_follow_ups WHERE next_step = 'Call Sunday'$q$,
    '42501', 'journey', 'directus_app cannot delete follow-up rows');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM visitor_journey_stages WHERE key = 'identify'$q$,
    '42501', 'journey', 'directus_app cannot delete seeded stages');

  DELETE FROM visitor_follow_ups WHERE next_step = 'Call Sunday';
  DELETE FROM visitor_journey_transitions;
  DELETE FROM visitors WHERE id = v_anchor;
END $$;

-- ---------------------------------------------------------------------------
-- 76.6  RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0008_visitor_journey.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_journey_stages WHERE branch IS NULL) = 5, 'journey',
    'rerun: still five global stages (ON CONFLICT DO NOTHING reseeds nothing)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_proc WHERE proname IN ('journey_can_advance', 'journey_pack_complete', 'journey_dropoff_complete', 'journey_required_pack_items', 'journey_transition_guard')) = 5, 'journey',
    'rerun: all five functions still present (OR REPLACE is a no-op)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'journey_transition_guard_trg'), 'journey',
    'rerun: the guard trigger still installed (DROP IF EXISTS + CREATE is idempotent)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM visitor_follow_ups) = 0
    AND (SELECT count(*) FROM visitor_journey_transitions) = 0, 'journey',
    'rerun: reseeding inserts nothing -- the suite cleaned its rows and the migration seeds no log rows');
  -- AFC-583: with 0025 owning the host table, this re-apply lands the
  -- §2.8 read model for the first time (the documented scratch skip,
  -- closed -- suite 90.4 pins the same landing from the register side).
  PERFORM test_support.assert_true(
    to_regclass('public.visitor_funnel') IS NOT NULL
    AND to_regclass('public.visitor_follow_up_status') IS NOT NULL, 'journey',
    'rerun: the funnel views land on re-apply now visitors exists');
END $$;
