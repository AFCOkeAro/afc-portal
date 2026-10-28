-- rollback/20261028_0046_event_payments_flag.down.sql
--
-- Reversal for 20261028_0046_event_payments_flag.sql (AFC-830).
--
-- What it destroys, stated plainly:
--   events.payments_enabled -- the per-event charging switch. Refuses while
--   any event has it on (that is an explicit activation, not a default to
--   silently drop).
--
-- What it does NOT destroy: event rows, or any grant on any table. Where
-- the column is absent (forward never applied) the script is a no-op with
-- a NOTICE.

DO $$
DECLARE
  v_on integer := 0;
BEGIN
  IF to_regclass('public.events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'events'
                    AND column_name = 'payments_enabled') THEN
    SELECT count(*) INTO v_on FROM events WHERE payments_enabled;
  END IF;

  IF v_on > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back the payments flag: % event(s) have payments enabled. Switch them off first; the flag is an explicit activation.',
      v_on
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'payments-flag rollback proceeding: no event charges.';
END $$;

ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS payments_enabled;
