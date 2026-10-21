-- rollback/20261020_0025_visitors_register.down.sql
--
-- Reversal for 20261020_0025_visitors_register.sql (AFC-583, parent AFC-566).
--
-- What it destroys, stated plainly:
--   visitors -- every newcomer row (names, contacts, visit and journey
--     detail, including minors; a rolled-back row cannot be re-derived,
--     and journey_started_at is ground truth for the funnel).
--   The two audit-trail merge FKs §3 added
--     (visitor_follow_ups_visitor_fkey,
--     visitor_journey_transitions_visitor_fkey). F4 for both: dropping them
--     is forced -- their definitions reference the visitors table this
--     script drops, so refusing would leave the script unrunnable. No
--     CASCADE: the failure of a hidden dependency must be loud.
--   The visitors-side FKs (visitors_person_fkey,
--     visitors_journey_stage_fkey): they live ON the dropped table and die
--     with it; dropped explicitly first so the script states every removal.
--   visitor_funnel + visitor_follow_up_status views (0008 §2.8 read model
--     over visitors). Dropping them is forced -- DROP TABLE visitors fails
--     while a view depends on it -- and they are a read model, not a
--     control (the rollback gate does not count DROP VIEW). 0008's down
--     script drops the same two views conditionally, so its re-drop is a
--     no-op; 0008's re-apply recreates them once visitors is back.
--
-- What it does NOT destroy: people/branches/stages rows (only referenced);
-- visitor_follow_ups / visitor_journey_transitions rows (0008 owns them --
-- this script refuses while the trail holds rows rather than orphan it,
-- see §0); the 0008 guard trigger, functions, stages or seeds; or any
-- grant on any other table. No DROP TRIGGER / DROP FUNCTION / DROP RULE
-- appears anywhere in this file -- the forward file creates none (the
-- journey guard belongs to 0008 and stays), so the rollback-control gate
-- has nothing to reconcile. Where visitors is absent (forward never
-- applied) every statement is IF EXISTS and the script is a no-op with a
-- NOTICE.
--
-- Down-order caveat: reverse order is 0025 -> 0023 -> 0021 -> 0020 ->
-- ... -> 0008. No later AFC-566 slice references visitors (verified:
-- only 0008 touches it, conditionally), so no hidden dependent FK can
-- strand the DROP TABLE below -- and if one ever lands, the DROP fails
-- loudly instead of cascading, by design. 0008's down script runs after
-- this one: its conditional column-drop block becomes a no-op once
-- visitors is gone, and its own refusal (while follow-ups or transitions
-- hold rows) is the complementary guard on the trail tables.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a register that holds rows, or a register whose
--    care trail still references it.
--
-- Newcomer rows are personal data incl. minors, and follow-ups /
-- transitions without their register are orphaned evidence. Empty tables
-- roll back; anything else needs a verified copy first and a reviewed
-- step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_visitors integer := 0;
  v_follow integer := 0;
  v_trans integer := 0;
BEGIN
  IF to_regclass('public.visitors') IS NOT NULL THEN
    SELECT count(*) INTO v_visitors FROM visitors;
  END IF;

  IF to_regclass('public.visitor_follow_ups') IS NOT NULL THEN
    SELECT count(*) INTO v_follow FROM visitor_follow_ups;
  END IF;

  IF to_regclass('public.visitor_journey_transitions') IS NOT NULL THEN
    SELECT count(*) INTO v_trans FROM visitor_journey_transitions;
  END IF;

  IF v_visitors > 0 OR v_follow > 0 OR v_trans > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back the visitors register: visitors holds % row(s), visitor_follow_ups holds % row(s), visitor_journey_transitions holds % row(s). These are newcomer-care rows (including minors); take a verified copy before proceeding. Empty tables roll back; anything else does not.',
      v_visitors, v_follow, v_trans
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'visitors rollback proceeding: no rows. Re-apply 20261020_0025 (then 20261020_0008 for the funnel views) to get the register back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The two audit-trail merge FKs §3 added (F4 -- they reference the
--    table dropped in §3), then the visitors-side FKs, then 0008's read
--    model, then the register. Dependency order, no CASCADE. IF EXISTS
--    throughout: absence is not failure.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS visitor_follow_ups DROP CONSTRAINT IF EXISTS visitor_follow_ups_visitor_fkey;

ALTER TABLE IF EXISTS visitor_journey_transitions DROP CONSTRAINT IF EXISTS visitor_journey_transitions_visitor_fkey;

ALTER TABLE IF EXISTS visitors DROP CONSTRAINT IF EXISTS visitors_person_fkey;

ALTER TABLE IF EXISTS visitors DROP CONSTRAINT IF EXISTS visitors_journey_stage_fkey;

DROP VIEW IF EXISTS visitor_funnel;

DROP VIEW IF EXISTS visitor_follow_up_status;

DROP TABLE IF EXISTS visitors;
