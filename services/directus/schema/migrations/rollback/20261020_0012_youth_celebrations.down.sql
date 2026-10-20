-- rollback/20261020_0012_youth_celebrations.down.sql
--
-- Reversal for 20261020_0012_youth_celebrations.sql. AFC-476 / AFC-463e.
--
-- What it destroys, stated plainly:
--   youth_profiles          -- the 1-1 youth extension rows.
--   youth_profile_events    -- the youth audit trail.
--   celebrations            -- the birthday/anniversary/shout-out rows.
--   celebration_events      -- the celebration audit trail.
--   person_previous_branches -- previous-branch history rows.
--   person_milestones       -- spiritual milestone rows.
--   The conditional FKs (§5: youth_profiles_branch/zone_fkey,
--   celebrations_branch/zone_fkey, person_previous_branches_branch_fkey,
--   person_milestones_branch/church_fkey) die with their tables; they
--   constrain no surviving object, so there is nothing to drop separately.
--   Parent tables (people/branches/zones) are never touched: this migration
--   never created them. No CASCADE: a hidden dependency must fail loudly,
--   not vanish silently. No trigger or function is created by the forward
--   file, so the rollback-control gate has only drops of objects this same
--   migration created to reconcile (F1: each referent goes in this same
--   script). No people status widening exists to reverse (the §4.2
--   expansion is withheld by the forward file), so no ALTER ... DROP
--   CONSTRAINT touches the surviving people table -- see §2).
--
-- §2. people columns are NOT dropped. Widening a live people table is a
-- one-way door: Directus rows may already use marital_status, is_youth or
-- the expanded status values, and dropping those columns would destroy
-- data this rollback was never asked to review. The down script restores
-- the six tables to absent and leaves the people hardening in place; a
-- status-set cleanup, if the board ever wants one, is its own ticket with
-- its own approval -- not done here on personal data including minors'.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back youth/celebration history that holds rows.
--
-- Youth rows hold children's PII and celebrations are captured greetings
-- with an audit trail. Empty tables roll back; anything else needs a
-- verified copy first and a reviewed step, not this script. The audit
-- tables count as rows: rolling back over events would destroy the record
-- of what happened, which is exactly what the trail is for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_youth integer; v_youth_events integer;
  v_celeb integer; v_celeb_events integer;
  v_prev integer; v_miles integer;
BEGIN
  SELECT count(*) INTO v_youth FROM youth_profiles;
  SELECT count(*) INTO v_youth_events FROM youth_profile_events;
  SELECT count(*) INTO v_celeb FROM celebrations;
  SELECT count(*) INTO v_celeb_events FROM celebration_events;
  SELECT count(*) INTO v_prev FROM person_previous_branches;
  SELECT count(*) INTO v_miles FROM person_milestones;

  IF v_youth > 0 OR v_youth_events > 0
     OR v_celeb > 0 OR v_celeb_events > 0
     OR v_prev > 0 OR v_miles > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back youth/celebrations: youth_profiles holds % row(s), youth_profile_events %, celebrations %, celebration_events %, person_previous_branches %, person_milestones %. These are youth PII and captured greetings including their audit trails. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_youth, v_youth_events, v_celeb, v_celeb_events, v_prev, v_miles
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'youth/celebrations rollback proceeding: no rows in any of the six tables. Re-apply 20261020_0012 to restore them; people §4.2 columns are left in place by design.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables in dependency order: event/history children before parents.
--    people is never touched (§2 above).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS youth_profile_events;
DROP TABLE IF EXISTS celebration_events;
DROP TABLE IF EXISTS person_previous_branches;
DROP TABLE IF EXISTS person_milestones;
DROP TABLE IF EXISTS youth_profiles;
DROP TABLE IF EXISTS celebrations;
