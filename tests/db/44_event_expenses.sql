-- tests/db/100_event_expenses.sql
--
-- AFC-801 (parent AFC-756). THE EVENT EXPENSES REGISTER CONTRACT.
--
-- Migration 0044 creates event_expenses: one row per recorded spend against
-- an event, branch/zone denormed from the parent event at write time,
-- category enum with a strict other-label pairing, amount >= 0, receipt link
-- to directus_files, append-only (no DELETE anywhere).
--
--   44.1 shape       -- the table exists with the columns the routes
--                        select, the documented types, nullability and
--                        defaults; no updated_at (append-only register).
--   44.2 enums       -- category outside the eight is rejected (23514);
--                        'other' without a label is rejected; a label on a
--                        non-other category is rejected; amount < 0 rejected.
--   44.3 links       -- expense on a missing event fails (23503); deleting
--                        an event that holds spend is REFUSED (restrict,
--                        never cascade, never null); branch/zone denorms are
--                        SET NULL; the receipt FK stays open while
--                        directus_files is absent (0044 merge contract).
--   44.4 guards      -- the app identity reads/inserts/updates operational
--                        columns, cannot touch the write-once audit ground
--                        truth (event/branch/zone/recorded_by), and deletes
--                        nothing (42501 on DELETE); validation rejects bad
--                        rows for the app too.
--   44.5 rerun       -- re-applying 20261025_0044 changes nothing.
--   44.6 empty rollback -- with no rows the down script drops the register;
--                        the forward file is re-applied after.
--   44.7 acceptance  -- zero orphan expenses.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch/zone scoping, capability gates, totals parity -- lives in the
-- route layer and is covered by
-- tests/web/event-expenses.contract.mjs. No retention probe: this register
-- carries no retention clock; erasure runs as retention_worker.

-- ---------------------------------------------------------------------------
-- 44.1 SHAPE. Table, columns, types, nullability, defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_default text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_expenses') IS NOT NULL, 'expenses',
    'event_expenses exists');

  -- Route-selected columns (EXPENSE_FIELDS in the expenses routes).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event_expenses'
        AND column_name IN ('id', 'event', 'branch', 'zone', 'category',
          'category_other_label', 'amount', 'currency', 'spent_on',
          'receipt', 'notes', 'recorded_by', 'created_at')) = 13, 'expenses',
    'event_expenses carries every column the routes select (13)');

  -- Append-only registers carry no updated_at.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'event_expenses'
                   AND column_name = 'updated_at'), 'expenses',
    'event_expenses carries no updated_at (append-only, corrections are new rows)');

  -- event + amount + spent_on are the load-bearing NOT NULLs.
  FOR v_nullable IN
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'event_expenses'
       AND column_name IN ('event', 'amount', 'spent_on')
  LOOP
    PERFORM test_support.assert_equals(v_nullable, 'NO', 'expenses',
      'event/amount/spent_on are NOT NULL (an expense needs its parent, its figure and its date)');
  END LOOP;

  -- branch/zone/receipt/notes/label are nullable by design (area-wide
  -- events, file-absent databases, non-other categories).
  FOR v_nullable IN
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'event_expenses'
       AND column_name IN ('branch', 'zone', 'category_other_label', 'receipt', 'notes')
  LOOP
    PERFORM test_support.assert_equals(v_nullable, 'YES', 'expenses',
      'branch/zone/label/receipt/notes are nullable (denorms, conditional link, optional text)');
  END LOOP;

  -- Defaults: NGN currency, now() stamp.
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'event_expenses'
     AND column_name = 'currency';
  PERFORM test_support.assert_true(v_default IS NOT NULL AND v_default LIKE '%NGN%', 'expenses',
    'currency defaults to NGN (' || coalesce(v_default, 'no default') || ')');
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'event_expenses'
     AND column_name = 'created_at';
  PERFORM test_support.assert_true(v_default IS NOT NULL, 'expenses',
    'created_at defaults to now()');
END $$;

-- ---------------------------------------------------------------------------
-- 44.2 ENUMS. Category set, other-label pairing, amount floor.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Expense Enum Probe', now(), now()) RETURNING id INTO v_event;

  -- AFC-825 (migration 0045): the static eight-way CHECK became a FOREIGN
  -- KEY into expense_categories, so an undocumented category now fails as
  -- 23503 rather than 23514. Still rejected, different constraint.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''confetti'', 10, CURRENT_DATE)',
    '23503', 'expenses', 'an undocumented category is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''other'', 10, CURRENT_DATE)',
    '23514', 'expenses', '''other'' without a label is rejected (other requires category_other_label)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, category_other_label, amount, spent_on) VALUES (''' || v_event::text || ''', ''other'', ''   '', 10, CURRENT_DATE)',
    '23514', 'expenses', '''other'' with a blank label is rejected');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, category_other_label, amount, spent_on) VALUES (''' || v_event::text || ''', ''venue'', ''leftover'', 10, CURRENT_DATE)',
    '23514', 'expenses', 'a label on a non-other category is rejected (stale labels cannot survive a correction)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''venue'', -1, CURRENT_DATE)',
    '23514', 'expenses', 'a negative amount is rejected');
  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO event_expenses (event, category, category_other_label, amount, spent_on) VALUES (''' || v_event::text || ''', ''other'', ''generator hire'', 0, CURRENT_DATE)',
    'expenses', 'a zero amount with a labelled other-category writes');

  DELETE FROM event_expenses WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 44.3 LINKS. FKs fail closed; delete semantics per the 0044 header.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_event uuid;
  v_orphan uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;

  -- Expense on a missing event fails (23503), never silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_orphan::text || ''', ''venue'', 10, CURRENT_DATE)',
    '23503', 'expenses', 'an expense on a missing event is rejected');

  INSERT INTO events (title, branch, start_at, end_at)
    VALUES ('Expense Link Event', v_branch, now(), now()) RETURNING id INTO v_event;
  INSERT INTO event_expenses (event, category, amount, spent_on)
    VALUES (v_event, 'feeding', 2500, CURRENT_DATE);

  -- Event delete is REFUSED while spend exists (financial fact blocks the
  -- delete loudly; it is never cascaded, never nulled). Plain RESTRICT and
  -- NO ACTION both surface as 23503 at runtime -- the confdeltype = 'r' pin
  -- below is what distinguishes RESTRICT from the default.
  PERFORM test_support.assert_raises(NULL,
    'DELETE FROM events WHERE id = ''' || v_event::text || '''',
    '23503', 'expenses', 'deleting an event that holds spend is refused (RESTRICT)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_expenses_event_fkey'
               AND confdeltype = 'r'), 'expenses',
    'expense event FK is RESTRICT (confdeltype r: the fact blocks the delete)');

  -- Branch/zone denorms clear on delete, never taking the row with them.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_expenses_branch_fkey'
               AND confdeltype = 'n'), 'expenses',
    'expense branch FK is SET NULL (a branch delete clears the denorm, never the row)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_expenses_zone_fkey'
               AND confdeltype = 'n'), 'expenses',
    'expense zone FK is SET NULL (a zone delete clears the denorm, never the row)');

  -- The receipt merge stays OPEN while directus_files is absent: the receipt
  -- is a bare uuid under the 0044 merge contract, never a stranded FK.
  PERFORM test_support.assert_true(
    (to_regclass('public.directus_files') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_receipt_fkey'))
    OR (to_regclass('public.directus_files') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_receipt_fkey')), 'expenses',
    'receipt FK present exactly when directus_files exists (conditional merge, never stranded)');

  DELETE FROM event_expenses WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 44.4 GUARDS. The app reads/inserts/updates operational columns, cannot
--        touch the write-once audit ground truth, and deletes nothing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_expense uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Guard Event', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM event_expenses$q$,
    'expenses', 'app reads the expense register');
  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''transport'', 1500, CURRENT_DATE)',
    'expenses', 'app records spend (probe row cleaned below)');
  SELECT id INTO v_expense FROM event_expenses WHERE event = v_event LIMIT 1;

  PERFORM test_support.assert_not_raises('directus_app',
    'UPDATE event_expenses SET notes = ''guard probe'' WHERE event IS NULL',
    'expenses', 'app corrects an operational column (notes)');
  PERFORM test_support.assert_not_raises('directus_app',
    'UPDATE event_expenses SET amount = amount WHERE event IS NULL',
    'expenses', 'app corrects an operational column (amount)');

  -- Write-once audit ground truth: the denorm and the stamps are not app-
  -- writable. Each must fail with 42501, not silently pass.
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE event_expenses SET event = event WHERE false',
    '42501', 'expenses', 'app cannot rewrite the parent link');
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE event_expenses SET branch = branch WHERE false',
    '42501', 'expenses', 'app cannot rewrite the branch denorm');
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE event_expenses SET zone = zone WHERE false',
    '42501', 'expenses', 'app cannot rewrite the zone denorm');
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE event_expenses SET recorded_by = recorded_by WHERE false',
    '42501', 'expenses', 'app cannot rewrite the recorder stamp');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM event_expenses WHERE false$q$,
    '42501', 'expenses', 'app cannot DELETE expenses (append-only, corrections are new rows)');
  -- AFC-825: same FK evolution for the app ceiling (23503, not 23514).
  PERFORM test_support.assert_raises('directus_app',
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''confetti'', 10, CURRENT_DATE)',
    '23503', 'expenses', 'an undocumented category is rejected for the app too');

  DELETE FROM event_expenses WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 44.5 RERUN. Re-applying 20261025_0044 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261025_0044_event_expenses.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_expenses') IS NOT NULL, 'expenses',
    'rerun: the register survives (IF NOT EXISTS, grants intact, seeds absent by design)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_expenses) = 0, 'expenses',
    'rerun: probe rows stayed cleaned (no invented figures)');
END $$;

-- ---------------------------------------------------------------------------
-- 44.6 EMPTY ROLLBACK. With no rows the down script drops the register;
--        the forward file is re-applied after, leaving the tree as found.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_expenses) = 0, 'expenses',
    'pre-rollback: empty register (probes above cleaned up)');
END $$;

\i services/directus/schema/migrations/rollback/20261025_0044_event_expenses.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_expenses') IS NULL, 'expenses',
    'empty-table rollback: the register is gone (no trigger added by choice 8; function shared with 0030 untouched)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'afc_set_child_scope'), 'expenses',
    'empty-table rollback: afc_set_child_scope() survives (owned by 0030, shared with every other child)');
END $$;

-- Leave the register present, as the forward migration leaves it.
\i services/directus/schema/migrations/20261025_0044_event_expenses.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_expenses') IS NOT NULL, 'expenses',
    're-apply: the register is back (idempotent forward, apply order)');
END $$;

-- ---------------------------------------------------------------------------
-- 44.7 ACCEPTANCE, as queries over the register itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans FROM event_expenses e
   WHERE NOT EXISTS (SELECT 1 FROM events v WHERE v.id = e.event);
  PERFORM test_support.assert_true(v_orphans = 0, 'expenses',
    'ACCEPTANCE: zero orphan expenses (event RESTRICT holds)');
END $$;
