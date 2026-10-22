-- rollback/20261022_0036_marriage_case_forms.down.sql
--
-- Reversal for 20261022_0036_marriage_case_forms.sql (AFC-677 phase B).
--
-- What it destroys, stated plainly:
--   marriage_case_forms  -- the per-stage form submissions.
--   The case FK dies with the table; marriage_cases, marriage_case_events
--   and every parent table (people / branches / zones) are never touched.
--   No CASCADE needed: the table has no children.

-- ---------------------------------------------------------------------------
-- 0. Refuse while submissions exist. These are captured ministry facts;
--    take a verified copy before proceeding. An empty table rolls back,
--    a populated one does not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_forms integer;
BEGIN
  SELECT count(*) INTO v_forms FROM marriage_case_forms;

  IF v_forms > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back marriage_case_forms: marriage_case_forms holds % row(s). These are captured ministry facts. Take a verified copy before proceeding; an empty table rolls back, a populated one does not.',
      v_forms
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'marriage_case_forms 0036 rollback proceeding: no submissions. Re-apply 20261022_0036 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The submissions table only.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS marriage_case_forms;
