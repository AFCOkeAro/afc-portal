-- rollback/20261020_0001_weca_returns.down.sql
--
-- Reversal for 20261020_0001_weca_returns.sql. AFC-451.
--
-- What it destroys, stated plainly:
--   branch_financial_records -- captured treasurer inputs (audited per US-F1).
--   weca_returns             -- computed returns.
--   weca_return_formulas     -- the board-ratified formula config (re-seedable
--                               from ADR-0008, but the row history is gone).
--   weca_compute_return()    -- the R1-R4 arithmetic.
--
-- ORDER: refuse first (while any captured row exists), then function, then
-- tables in dependency order (weca_returns references both others).
-- No CASCADE: a hidden dependency must fail loudly, not vanish silently.
-- No trigger/function control is dropped (the function RETURNS void, not
-- trigger), so the rollback-control gate has nothing to reconcile beyond the
-- referent drops, which this script removes entirely (F1).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a feature that holds captured data.
--
-- A rollback that drops finance tables under live rows destroys audited
-- treasurer inputs. Empty tables roll back; anything else needs a verified
-- copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_records integer;
  v_returns integer;
BEGIN
  SELECT count(*) INTO v_records FROM branch_financial_records;
  SELECT count(*) INTO v_returns FROM weca_returns;

  IF v_records > 0 OR v_returns > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back weca_returns: branch_financial_records holds % row(s) and weca_returns holds % row(s). These are captured treasurer inputs and computed dues. Take a verified copy before proceeding; an empty feature rolls back, a populated one does not.',
      v_records, v_returns
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'weca rollback proceeding: no captured financial records, no computed returns. The weca-2026-01 formula row is still being destroyed -- re-seed it from ADR-0008 if the feature comes back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Function, then tables in dependency order.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS weca_compute_return(uuid);

DROP TABLE IF EXISTS weca_returns;
DROP TABLE IF EXISTS branch_financial_records;
DROP TABLE IF EXISTS weca_return_formulas;
