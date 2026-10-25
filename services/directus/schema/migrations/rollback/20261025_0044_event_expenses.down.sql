-- rollback/20261025_0044_event_expenses.down.sql
--
-- Reversal for 20261025_0044_event_expenses.sql (AFC-801).
--
-- What it destroys, stated plainly:
--   event_expenses -- every row (per-event spend facts; a rolled-back row
--     cannot be re-derived, and amounts are staff-captured ground truth).
--   The §2 indexes + CHECKs. FKs die with the table; no separate drop.
--   The receipt FK (conditional, may never have existed) needs no drop
--   either -- it dies with the table. No cascading drop: a hidden
--   dependency must fail loudly, not vanish silently.
--
-- What it does NOT destroy: events/branches/zones rows (only referenced),
-- the afc_set_child_scope() FUNCTION (owned by 0030 -- the forward file
-- adds no trigger by choice 8), or any grant on any other table. Where the
-- table is absent (forward never applied) every statement is IF EXISTS and
-- the script is a no-op with a NOTICE.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a register that holds rows.
--
-- Expenses are financial facts. Empty tables roll back; anything else needs
-- a verified copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_expenses integer := 0;
BEGIN
  IF to_regclass('public.event_expenses') IS NOT NULL THEN
    SELECT count(*) INTO v_expenses FROM event_expenses;
  END IF;

  IF v_expenses > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event_expenses: the table holds % row(s). These are recorded spend facts; take a verified copy before proceeding. Empty tables roll back; anything else does not.',
      v_expenses
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'event_expenses rollback proceeding: no rows. Re-apply 20261025_0044 to get the table back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The expense register. No cascading drop. IF EXISTS throughout: absence is not
--    failure. (The forward file adds no trigger by choice 8, so there is no
--    trigger to drop; the rollback-control gate has nothing to reconcile.)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS event_expenses;
