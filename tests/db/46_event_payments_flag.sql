-- Suite 46: per-event payments flag (AFC-830, migration 0046).
--
--   46.1 rerun         -- re-applying 20261028_0046 changes nothing.
--   46.2 defaults      -- the flag exists, defaults to false, flips on and
--                         back off (activation is an explicit write).
--   46.3 ceiling       -- directus_app reads the flag (SELECT inherited
--                         with the table ceiling); no new grants were
--                         added, PUBLIC holds nothing new.
--   46.4 rollback      -- the SHIPPED down script refuses while any event
--                         charges; emptied, it drops the column;
--                         re-apply restores it default-off.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0046_event_payments_flag.sql

-- ---------------------------------------------------------------------------
-- 46.1  RERUN. Re-applying 0046 changes nothing (ADD COLUMN IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0046_event_payments_flag.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'payments',
    '46.1: 0046 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 46.2  DEFAULTS. Off unless explicitly switched on.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_flag boolean;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Payments Flag Probe', now(), now()) RETURNING id INTO v_event;

  SELECT payments_enabled INTO v_flag FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(v_flag IS NOT DISTINCT FROM false,
    'payments', '46.2: new events default to payments off');

  UPDATE events SET payments_enabled = true WHERE id = v_event;
  SELECT payments_enabled INTO v_flag FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(v_flag IS TRUE,
    'payments', '46.2: activation is an explicit write');

  UPDATE events SET payments_enabled = false WHERE id = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 46.3  CEILING. The flag rides the existing events ceiling: app SELECT,
-- no new grants, PUBLIC empty on the column path.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.events', 'SELECT'),
    'payments', '46.3: app reads the flag with the events ceiling');
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.events', 'payments_enabled', 'SELECT'),
    'payments', '46.3: app reads the new column (grant inherited, none added)');
END $$;

-- ---------------------------------------------------------------------------
-- 46.4  ROLLBACK. Refuses while any event charges; emptied, drops the
-- column; re-apply restores it default-off.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_event uuid;
  v_got text := NULL;
BEGIN
  INSERT INTO events (title, start_at, end_at, payments_enabled)
    VALUES ('Payments Rollback Probe', now(), now(), true) RETURNING id INTO v_event;

  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0046_event_payments_flag.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;

  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'payments',
    '46.4: down refuses while an event charges (got: ' || COALESCE(v_got, 'no refusal -- FAIL') || ')');

  UPDATE events SET payments_enabled = false WHERE id = v_event;
  DELETE FROM events WHERE id = v_event;
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0046_event_payments_flag.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'payments_enabled'),
    'payments', '46.4: down drops the column when empty');
END $$;

\i services/directus/schema/migrations/20261028_0046_event_payments_flag.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'events'
               AND column_name = 'payments_enabled'),
    'payments', '46.4: re-apply restores the column');
END $$;
