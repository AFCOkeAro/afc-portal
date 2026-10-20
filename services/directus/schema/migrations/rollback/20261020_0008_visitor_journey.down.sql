-- rollback/20261020_0008_visitor_journey.down.sql
--
-- Reversal for 20261020_0008_visitor_journey.sql. AFC-471 / AFC-462.
--
-- What it destroys, stated plainly:
--   visitor_journey_transitions (+ its guard trigger journey_transition_guard_trg
--     and function journey_transition_guard) -- the stage-move audit trail.
--   visitor_follow_ups -- the outcome log.
--   visitor_journey_stages (+ the five seeded stages and the four partial
--     unique indexes) -- the ordered reference.
--   journey_can_advance, journey_pack_complete, journey_dropoff_complete,
--     journey_required_pack_items -- the pure gates.
--   visitor_funnel + visitor_follow_up_status views -- only where the
--     visitors table exists (the forward file skips them otherwise, so the
--     drops are conditional too).
--   The visitors journey-delta columns (§6) + visitors_journey_stage_fkey --
--     only where the host table exists.
--
-- ORDER: refuse first (follow-ups or transitions holding rows means audited
-- newcomer care would be destroyed -- needs a verified copy and a reviewed
-- step, not this script), then the guard trigger, then views, then audit/log
-- tables, then the reference, then functions, then conditional columns last.
-- No CASCADE: a hidden dependency must fail loudly, not vanish silently.
--
-- ROLLBACK-CONTROL RECONCILIATION (scripts/migration-rollback-gate.mjs):
--   DROP TRIGGER journey_transition_guard_trg -- F1: its referent
--     (visitor_journey_transitions) is dropped by THIS script.
--   DROP FUNCTION journey_transition_guard -- the trigger's own function,
--     dropped with the trigger it serves (F1b-equivalent: it reads only
--     columns/tables this script drops).
--   No other control is dropped: the views are a read model, the columns
--     are data, and no CHECK on a surviving table is removed (the visitors
--     CHECKs added in §6 constrain columns this script also drops).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a journey that holds audited rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_trans integer; v_follow integer;
BEGIN
  SELECT count(*) INTO v_trans FROM visitor_journey_transitions;
  SELECT count(*) INTO v_follow FROM visitor_follow_ups;

  IF v_trans > 0 OR v_follow > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back 20261020_0008: visitor_journey_transitions holds % row(s) and visitor_follow_ups holds % row(s). The journey audit trail is evidence; export and verify it before any reversal.',
      v_trans, v_follow
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Guard trigger + function (F1: the referent table goes in §3).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS journey_transition_guard_trg
  ON visitor_journey_transitions;
DROP FUNCTION IF EXISTS journey_transition_guard();

-- ---------------------------------------------------------------------------
-- 2. Views, where the host table exists (mirrors the forward conditional).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NOT NULL THEN
    DROP VIEW IF EXISTS visitor_funnel;
    DROP VIEW IF EXISTS visitor_follow_up_status;
    RAISE NOTICE 'visitor_funnel + visitor_follow_up_status views dropped.';
  ELSE
    RAISE NOTICE 'Views were never created (no visitors table); nothing to drop.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit + log + reference tables (children before parents).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS visitor_journey_transitions;
DROP TABLE IF EXISTS visitor_follow_ups;
DROP TABLE IF EXISTS visitor_journey_stages;

-- ---------------------------------------------------------------------------
-- 4. Pure gates.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS journey_can_advance(integer, integer);
DROP FUNCTION IF EXISTS journey_pack_complete(jsonb, text[]);
DROP FUNCTION IF EXISTS journey_dropoff_complete(text);
DROP FUNCTION IF EXISTS journey_required_pack_items();

-- ---------------------------------------------------------------------------
-- 5. Conditional visitors columns, last (mirrors the forward conditional).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE NOTICE 'visitors table not present; no journey columns to drop.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_journey_stage_fkey') THEN
    ALTER TABLE visitors DROP CONSTRAINT visitors_journey_stage_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_dropoff_outcome_valid') THEN
    ALTER TABLE visitors DROP CONSTRAINT visitors_dropoff_outcome_valid;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_last_contact_channel_valid') THEN
    ALTER TABLE visitors DROP CONSTRAINT visitors_last_contact_channel_valid;
  END IF;

  ALTER TABLE visitors DROP COLUMN IF EXISTS welfare_officer_assigned_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS last_contact_channel;
  ALTER TABLE visitors DROP COLUMN IF EXISTS last_contact_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS next_check_in_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS dropoff_visited_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS dropoff_outcome;
  ALTER TABLE visitors DROP COLUMN IF EXISTS pack_checklist;
  ALTER TABLE visitors DROP COLUMN IF EXISTS journey_started_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS journey_stage_entered_at;
  ALTER TABLE visitors DROP COLUMN IF EXISTS journey_stage;
  RAISE NOTICE 'visitors journey columns dropped.';
END
$$;
