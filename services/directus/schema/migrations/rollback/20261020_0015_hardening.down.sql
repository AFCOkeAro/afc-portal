-- rollback/20261020_0015_hardening.down.sql
--
-- Reversal for 20261020_0015_hardening.sql. AFC-486 / AFC-465d.
--
-- What it destroys, stated plainly:
--   hardening_tick_slo_met(), hardening_estimate_cost(),
--     hardening_suppressed()  -- pure/STABLE predicates owned by this slice.
--   hardening_monitor_checks   -- monitoring log (childless, append-only).
--   person_duplicate_reviews   -- duplicate warnings + branch-admin decisions.
--   campaign_cost_rates        -- the rate card.
--   communication_suppressions -- the STOP registry.
--
-- Parent tables (people/branches/...) are never touched: person and branch
-- links here are bare uuids and no FK was ever created. No CASCADE: a hidden
-- dependency must fail loudly, not vanish silently. No trigger or control
-- created elsewhere is removed — the forward file creates none, so the
-- rollback-control gate has only drops of objects this same migration
-- created to reconcile.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a hardening history that holds rows.
--
-- Suppressions, decisions, rates, and check outcomes are the audit trail of
-- who was silenced, what a message cost, who decided a duplicate, and what
-- the monitors saw. Empty tables roll back; anything else needs a verified
-- copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_suppressions integer; v_rates integer; v_reviews integer; v_checks integer;
BEGIN
  SELECT count(*) INTO v_suppressions FROM communication_suppressions;
  SELECT count(*) INTO v_rates FROM campaign_cost_rates;
  SELECT count(*) INTO v_reviews FROM person_duplicate_reviews;
  SELECT count(*) INTO v_checks FROM hardening_monitor_checks;

  IF v_suppressions > 0 OR v_rates > 0 OR v_reviews > 0 OR v_checks > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back hardening: communication_suppressions holds % row(s), campaign_cost_rates % row(s), person_duplicate_reviews % row(s), hardening_monitor_checks % row(s). These are the audit trail of withdrawals, costs, dedupe decisions, and monitor outcomes. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_suppressions, v_rates, v_reviews, v_checks
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'hardening rollback proceeding: no rows in any hardening table. Re-apply 20261020_0015 to restore them.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Functions first (they read the tables), then tables. No dependents
--    exist outside this slice: the Flows call them by name and tolerate
--    their absence as "hardening not installed".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS hardening_tick_slo_met(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS hardening_estimate_cost(integer, numeric);
DROP FUNCTION IF EXISTS hardening_suppressed(text, text);

DROP TABLE IF EXISTS hardening_monitor_checks;
DROP TABLE IF EXISTS person_duplicate_reviews;
DROP TABLE IF EXISTS campaign_cost_rates;
DROP TABLE IF EXISTS communication_suppressions;
