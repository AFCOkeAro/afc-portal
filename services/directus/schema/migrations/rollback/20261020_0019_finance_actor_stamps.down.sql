-- rollback/20261020_0019_finance_actor_stamps.down.sql
--
-- Reversal for 20261020_0019_finance_actor_stamps.sql. AFC-544.
--
-- What it destroys, stated plainly:
--   weca_returns.submitted_by / .confirmed_by -- the actor stamps this
--     migration added. The table itself survives; only the two columns go.
--
-- ORDER: refuse first (while any return carries an actor), then REVOKE the
-- column grants, then DROP the columns. No CASCADE: a hidden dependency
-- must fail loudly, not vanish silently. No trigger/function/control created
-- by the forward file exists, so the rollback-control gate has only the two
-- referent column drops to reconcile (F1b: columns added by this migration
-- and dropped by this script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back an actor trail that names anyone.
--
-- A NULL actor is "never transitioned"; a non-NULL actor is attribution of
-- who submitted or confirmed a dues figure. Empty-of-actors rolls back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_submitted integer;
  v_confirmed integer;
BEGIN
  SELECT count(*) INTO v_submitted FROM weca_returns WHERE submitted_by IS NOT NULL;
  SELECT count(*) INTO v_confirmed FROM weca_returns WHERE confirmed_by IS NOT NULL;

  IF v_submitted > 0 OR v_confirmed > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back finance actor stamps: % return(s) carry a submitted_by actor and % carry a confirmed_by actor. These name who submitted or confirmed dues figures. Take a verified copy before proceeding; a trail that names nobody rolls back, one that names someone does not.',
      v_submitted, v_confirmed
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'finance actor-stamp rollback proceeding: no return names an actor. Re-apply 20261020_0019 to restore the columns.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Revoke the column grants, then drop the columns this migration added.
-- ---------------------------------------------------------------------------
REVOKE UPDATE (submitted_by, confirmed_by) ON weca_returns FROM directus_app;

ALTER TABLE IF EXISTS weca_returns DROP COLUMN IF EXISTS submitted_by;
ALTER TABLE IF EXISTS weca_returns DROP COLUMN IF EXISTS confirmed_by;
