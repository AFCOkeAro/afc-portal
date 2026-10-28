-- Migration 0046: per-event payments flag (AFC-830, chairman direction
-- 2026-10-27: "we do not charge for our events").
--
-- Adds events.payments_enabled (boolean, NOT NULL, DEFAULT false). The
-- portal hides every payment surface (programme-settings fee/currency,
-- event-dashboard payment breakdown, registration-manage payment fields)
-- unless the flag is on for that event. Default off: existing and new
-- events stay payment-free until explicitly activated.
--
-- No new grants: the column inherits the table ceiling (SELECT for
-- directus_app is already there; writes ride the existing events update
-- path). No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-830). R2 CTO review on
-- the AFC-830 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0046_event_payments_flag.down.sql (refuses
-- while any event has the flag on; otherwise drops the column). Owner:
-- migration role (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). events must already belong
--    to directus_migrator: only an owner may ALTER it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('events')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the payments flag: % is not owned by '
      'directus_migrator, and only an owner can ALTER it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. events.payments_enabled. Default off: charging is opt-in per event.
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN IF NOT EXISTS payments_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.payments_enabled IS
  'AFC-830: per-event payments switch. The portal hides fee/currency settings, the dashboard payment breakdown and registration payment fields unless this is on. Default off.';
