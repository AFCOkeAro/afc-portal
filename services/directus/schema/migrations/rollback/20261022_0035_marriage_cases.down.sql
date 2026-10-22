-- rollback/20261022_0035_marriage_cases.down.sql
--
-- Reversal for 20261022_0035_marriage_cases.sql (AFC-674 scope A).
--
-- What it destroys, stated plainly:
--   marriage_case_events   -- the stage history trail.
--   marriage_cases         -- the pipeline rows.
--   The conditional FKs die with the tables; parent tables (people /
--   branches / zones) are never touched. No CASCADE: the trail is dropped
--   first, explicitly, so the case table drops clean.
--   marriage_matters (0013) is never touched: this rollback owns only what
--   0035 created.

-- ---------------------------------------------------------------------------
-- 0. Refuse while pipeline cases exist. These are captured ministry facts;
--    take a verified copy before proceeding. Empty tables roll back,
--    populated ones do not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cases integer; v_events integer;
BEGIN
  SELECT count(*) INTO v_cases FROM marriage_cases;
  SELECT count(*) INTO v_events FROM marriage_case_events;

  IF v_cases > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back marriage_cases: marriage_cases holds % row(s) and marriage_case_events holds % row(s). These are captured ministry facts. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_cases, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'marriage_cases 0035 rollback proceeding: no cases and no trail rows. Re-apply 20261022_0035 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Trail first (child of marriage_cases), then the case table.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS marriage_case_events;

DROP TABLE IF EXISTS marriage_cases;
