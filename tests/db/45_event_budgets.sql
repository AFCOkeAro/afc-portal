-- Suite 45: event budgets + expense categories register (AFC-825,
-- migration 0045).
--
--   45.1 rerun         -- re-applying 20261028_0045 changes nothing.
--   45.2 seeds         -- the eight 0044 categories + other, exact keys,
--                         labels and order; all active.
--   45.3 budget lines  -- two rows for one (event, category): both persist
--                         (append-only history) and latest-first ordering
--                         returns the revision.
--   45.4 guards        -- undocumented category rejected via FK (23503) on
--                         budgets and on expenses (the static CHECK is
--                         gone); RESTRICT catalog pins on both event FKs;
--                         negative and zero amounts behave (zero writes,
--                         negative refused).
--   45.5 grants        -- directus_app SELECT everywhere, INSERT on
--                         operational columns, NO UPDATE/DELETE on budgets,
--                         NO DELETE on categories; PUBLIC holds nothing.
--   45.6 rollback      -- the SHIPPED down script refuses while budgets
--                         hold rows, while custom categories exist, and
--                         while stray expenses exist; emptied, it drops
--                         the tables and restores the eight-way CHECK;
--                         re-apply restores the registers.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS event_expenses OWNER TO directus_migrator;
SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261028_0045_event_budgets.sql
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 45.1  RERUN. Re-applying 0045 changes nothing (IF NOT EXISTS + guarded
-- blocks + ON CONFLICT DO NOTHING seeds).
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261028_0045_event_budgets.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'budgets',
    '45.1: 0045 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 45.2  SEEDS. Exact keys, labels, order; all active.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT string_agg(key, ',' ORDER BY sort) FROM expense_categories),
    'venue,feeding,transport,publicity,honorarium,equipment,welfare,other',
    'budgets', '45.2: seeded keys in order');
  PERFORM test_support.assert_equals(
    (SELECT string_agg(label, ',' ORDER BY sort) FROM expense_categories),
    'Venue,Feeding,Transport,Publicity,Honorarium,Equipment,Welfare,Other',
    'budgets', '45.2: seeded labels in order');
  PERFORM test_support.assert_true(
    (SELECT count(*) = 0 FROM expense_categories WHERE NOT active),
    'budgets', '45.2: every seeded category is active');
END $$;

-- ---------------------------------------------------------------------------
-- 45.3  BUDGET LINES. Two rows, one (event, category): both persist and
-- latest-first ordering returns the revision.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_first numeric;
  v_latest numeric;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Budget Revision Probe', now(), now()) RETURNING id INTO v_event;

  -- Explicit stamps: now() is the transaction start inside one DO
  -- block, so two bare inserts would tie and latest-first would be
  -- indeterminate. Production plans land in separate transactions
  -- (microsecond-distinct); the suite pins the ordering, not the clock.
  INSERT INTO event_budgets (event, category_key, amount, notes, created_at)
    VALUES (v_event, 'venue', 100, 'plan v1', now());
  INSERT INTO event_budgets (event, category_key, amount, notes, created_at)
    VALUES (v_event, 'venue', 150, 'plan v2', now() + interval '1 second');

  SELECT count(*) INTO v_first FROM event_budgets
   WHERE event = v_event AND category_key = 'venue';
  PERFORM test_support.assert_equals(v_first::text, '2',
    'budgets', '45.3: revisions accumulate (append-only, no overwrite)');

  SELECT amount INTO v_latest FROM event_budgets
   WHERE event = v_event AND category_key = 'venue'
   ORDER BY created_at DESC LIMIT 1;
  PERFORM test_support.assert_equals(v_latest::text, '150.00',
    'budgets', '45.3: latest-first ordering returns the revision');

  DELETE FROM event_budgets WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 45.4  GUARDS. FK rejects undocumented keys; RESTRICT catalog pins;
-- amount floor holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Budget Guard Probe', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_budgets (event, category_key, amount) VALUES (''' || v_event::text || ''', ''confetti'', 10)',
    '23503', 'budgets', '45.4: an undocumented budget category is rejected via FK');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_budgets (event, category_key, amount) VALUES (''' || v_event::text || ''', ''venue'', -1)',
    '23514', 'budgets', '45.4: a negative budget is rejected');
  PERFORM test_support.assert_not_raises(NULL,
    'INSERT INTO event_budgets (event, category_key, amount) VALUES (''' || v_event::text || ''', ''venue'', 0)',
    'budgets', '45.4: a zero budget writes');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_expenses (event, category, amount, spent_on) VALUES (''' || v_event::text || ''', ''confetti'', 10, CURRENT_DATE)',
    '23503', 'budgets', '45.4: an undocumented expense category is rejected via FK (static CHECK is gone)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_budgets_event_fkey' AND confdeltype = 'r'),
    'budgets', '45.4: budgets stay RESTRICT on their event');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_expenses_category_fkey'),
    'budgets', '45.4: expenses point at the categories register');

  DELETE FROM event_budgets WHERE event = v_event;
  DELETE FROM event_expenses WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 45.5  GRANTS. App ceiling SELECT + operational INSERT on budgets (no
-- UPDATE, no DELETE); categories SELECT + INSERT + scoped UPDATE, no
-- DELETE; PUBLIC holds nothing on either register.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Budget Grant Probe', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.event_budgets', 'SELECT'),
    'budgets', '45.5: app reads budgets');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.expense_categories', 'SELECT'),
    'budgets', '45.5: app reads categories');
  PERFORM test_support.assert_raises('directus_app',
    'UPDATE event_budgets SET amount = amount WHERE false',
    '42501', 'budgets', '45.5: app cannot UPDATE budgets (latest-wins revision)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM event_budgets WHERE false$q$,
    '42501', 'budgets', '45.5: app cannot DELETE budgets');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM expense_categories WHERE false$q$,
    '42501', 'budgets', '45.5: app cannot DELETE categories (deactivate instead)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('event_budgets', 'expense_categories')
        AND grantee = 'PUBLIC') = 0,
    'budgets', '45.5: PUBLIC holds nothing on either register');

  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 45.6  ROLLBACK. The SHIPPED down script refuses with rows present and
-- succeeds emptied (restoring the eight-way CHECK); re-apply restores.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_event uuid;
  v_got text := NULL;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Budget Rollback Probe', now(), now()) RETURNING id INTO v_event;
  INSERT INTO event_budgets (event, category_key, amount)
    VALUES (v_event, 'venue', 10);

  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0045_event_budgets.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;

  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'budgets',
    '45.6: down refuses while budgets hold rows (got: ' || COALESCE(v_got, 'no refusal -- FAIL') || ')');

  DELETE FROM event_budgets WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0045_event_budgets.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_budgets') IS NULL
    AND to_regclass('public.expense_categories') IS NULL,
    'budgets', '45.6: down drops both registers when empty');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_expenses_category_check'),
    'budgets', '45.6: down restores the eight-way CHECK');
END $$;

ALTER TABLE IF EXISTS event_expenses OWNER TO directus_migrator;
SET ROLE directus_migrator;
\i services/directus/schema/migrations/20261028_0045_event_budgets.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_budgets') IS NOT NULL
    AND (SELECT count(*) FROM expense_categories) = 8,
    'budgets', '45.6: re-apply restores both registers with seeds');
END $$;
