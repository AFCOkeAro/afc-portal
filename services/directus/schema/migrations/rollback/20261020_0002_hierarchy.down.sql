-- rollback/20261020_0002_hierarchy.down.sql
--
-- Reversal for 20261020_0002_hierarchy.sql. AFC-466 / AFC-461a.
--
-- What it destroys, stated plainly:
--   areas, zones, branches, bible_study_centres, conference_centres,
--   sunday_school_classes, avs_centres, campus_institutions -- the hierarchy
--   itself, INCLUDING the Lagos North seed (1 area, 6 zones, 7 branches,
--   9 BSCs). A rollback of unseeded structure and a rollback of seeded
--   structure are the same file because the seed lives in the migration.
--   The WECA FKs added in §9 (branch_financial_records_branch_fkey,
--   weca_returns_branch_fkey) -- dropped first, so the hierarchy tables
--   can go. The finance TABLES stay; only the FKs to branches go.
--   The conditional denorm columns (§10: attendance_sessions.zone/.bsc,
--   households.zone/.household_head, directus_users.area/.zone/.zone_ids)
--   are dropped only where the host table exists; their absence is not a
--   failure, because the forward migration may have skipped them too.
--
-- ORDER: refuse first (while any hierarchy or finance row exists), then WECA
-- FKs, then denorm columns, then tables in dependency order (children
-- before parents). No CASCADE: a hidden dependency must fail loudly, not
-- vanish silently. No trigger/function is created by the forward file, so
-- the rollback-control gate has only the two referent FK drops to reconcile.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a hierarchy that holds rows.
--
-- Hierarchy rows are audited church structure. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script. Finance references count too: dropping branches under captured
-- treasurer inputs would strand branch_financial_records.branch as a bare
-- uuid with no referent -- the exact fork the forward file closed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_areas integer; v_zones integer; v_branches integer; v_bsc integer;
  v_conf integer;  v_ssc integer;   v_avs integer;     v_camp integer;
  v_fin integer;   v_ret integer;
BEGIN
  SELECT count(*) INTO v_areas FROM areas;
  SELECT count(*) INTO v_zones FROM zones;
  SELECT count(*) INTO v_branches FROM branches;
  SELECT count(*) INTO v_bsc FROM bible_study_centres;
  SELECT count(*) INTO v_conf FROM conference_centres;
  SELECT count(*) INTO v_ssc FROM sunday_school_classes;
  SELECT count(*) INTO v_avs FROM avs_centres;
  SELECT count(*) INTO v_camp FROM campus_institutions;

  IF v_areas > 0 OR v_zones > 0 OR v_branches > 0 OR v_bsc > 0
     OR v_conf > 0 OR v_ssc > 0 OR v_avs > 0 OR v_camp > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back hierarchy: areas=%, zones=%, branches=%, bsc=%, conference=%, sunday_school=%, avs=%, campus=% row(s). These are audited church structure including the Lagos North seed. Take a verified copy before proceeding; an empty hierarchy rolls back, a populated one does not.',
      v_areas, v_zones, v_branches, v_bsc, v_conf, v_ssc, v_avs, v_camp
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF to_regclass('public.branch_financial_records') IS NOT NULL THEN
    SELECT count(*) INTO v_fin FROM branch_financial_records;
  ELSE
    v_fin := 0;
  END IF;
  IF to_regclass('public.weca_returns') IS NOT NULL THEN
    SELECT count(*) INTO v_ret FROM weca_returns;
  ELSE
    v_ret := 0;
  END IF;

  IF v_fin > 0 OR v_ret > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back hierarchy: branch_financial_records holds % row(s) and weca_returns holds % row(s) whose branch FK points at branches(id). Dropping branches would strand them as bare uuids. Empty finance tables roll back; populated ones do not.',
      v_fin, v_ret
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'hierarchy rollback proceeding: no hierarchy rows, no finance references. The Lagos North seed is still being destroyed -- re-apply 20261020_0002 to get it back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. WECA FKs added by forward §9, then denorm columns added by forward §10.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS branch_financial_records DROP CONSTRAINT IF EXISTS branch_financial_records_branch_fkey;
ALTER TABLE IF EXISTS weca_returns DROP CONSTRAINT IF EXISTS weca_returns_branch_fkey;

ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS bsc;
ALTER TABLE IF EXISTS attendance_sessions DROP COLUMN IF EXISTS zone;
ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS household_head;
ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS zone;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS zone_ids;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS zone;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS area;

-- ---------------------------------------------------------------------------
-- 2. Tables in dependency order: children before parents.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS avs_centres;
DROP TABLE IF EXISTS sunday_school_classes;
DROP TABLE IF EXISTS conference_centres;
DROP TABLE IF EXISTS bible_study_centres;
DROP TABLE IF EXISTS campus_institutions;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS areas;
