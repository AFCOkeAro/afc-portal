-- rollback/20261023_0041_household_address_bsc.down.sql
--
-- Reversal for 20261023_0041_household_address_bsc.sql (AFC-771).
--
-- What it destroys, stated plainly:
--   households.address_1, address_2, city, state, zip, country -- the
--     structured parts. Safe to drop: every part ever written is also
--     composed into the legacy `households.address` line (route +
--     backfill), so the words survive on the legacy column.
--   households.latitude / longitude -- the map pin. NOT safe to drop
--     while set: the legacy address carries no coordinates.
--   people.bsc -- each member's centre link. NOT safe to drop while
--     set: no other column names the centre.
--   The households_lat_check / households_lng_check constraints, the
--   people_bsc_fkey FK, and the two partial indexes. All live ON the
--   dropped columns and die with them; dropped explicitly first so the
--   script states every removal. No CASCADE: a hidden dependency must
--   fail loudly.
--
-- What it does NOT destroy: household or people rows; the legacy
-- `households.address` line; household_head / primary_contact links; or
-- any grant on any other column. No DROP TRIGGER / DROP FUNCTION /
-- DROP RULE appears anywhere in this file -- the forward file creates
-- none, so the rollback-control gate has nothing to reconcile. Where
-- the tables are absent (forward never applied) every statement is
-- conditional and the script is a no-op with a NOTICE.
--
-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back pins and links that have no legacy copy.
--
-- Geo pins and centre links are family facts (including minors). Empty
-- (all-NULL) rolls back; anything else needs a verified copy first and
-- a reviewed step, not this script. Structured text rolls back freely:
-- the composed legacy address carries the same words.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bsc integer := 0;
  v_geo integer := 0;
BEGIN
  IF to_regclass('public.people') IS NULL
     AND to_regclass('public.households') IS NULL THEN
    RAISE NOTICE 'people and households are absent: nothing to roll back.';
    RETURN;
  END IF;

  IF to_regclass('public.people') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'people'
                    AND column_name = 'bsc') THEN
    SELECT count(*) INTO v_bsc FROM people WHERE bsc IS NOT NULL;
  END IF;

  IF to_regclass('public.households') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'households'
                    AND column_name IN ('latitude', 'longitude')) THEN
    SELECT count(*) INTO v_geo FROM households
     WHERE latitude IS NOT NULL OR longitude IS NOT NULL;
  END IF;

  IF v_bsc > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back member BSC links: % people row(s) carry a non-null bsc. These are family facts (including minors); take a verified copy before proceeding. All-NULL rolls back; anything else does not.',
      v_bsc
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_geo > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back household geo pins: % households row(s) carry a latitude or longitude. The legacy address carries no coordinates; take a verified copy before proceeding. All-NULL rolls back; anything else does not.',
      v_geo
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'household address/BSC rollback proceeding: no pins or links assigned. Re-apply 20261023_0041 to get the columns back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. people.bsc: the FK, then the column (the index lives on the column
--    and dies with it; dropped explicitly so the script states every
--    removal). Conditional throughout: absence is not failure.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS people_bsc_idx;

ALTER TABLE IF EXISTS people DROP CONSTRAINT IF EXISTS people_bsc_fkey;

ALTER TABLE IF EXISTS people DROP COLUMN IF EXISTS bsc;

-- ---------------------------------------------------------------------------
-- 2. households structured address + geo: the CHECKs, then the columns.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS households_city_idx;

ALTER TABLE IF EXISTS households DROP CONSTRAINT IF EXISTS households_lat_check;

ALTER TABLE IF EXISTS households DROP CONSTRAINT IF EXISTS households_lng_check;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS latitude;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS longitude;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS address_1;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS address_2;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS city;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS state;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS zip;

ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS country;
