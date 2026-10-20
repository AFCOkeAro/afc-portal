-- tests/db/68_weca_returns.sql
--
-- AFC-451 / ADR-0008. THE TEST THAT PROVES THE FORMULA PROMISE.
--
-- The figures below are not invented fixtures: they are the board's own
-- January 2026 Lagos North rows, verified against the workbook at the XML
-- level (formula cells, not display text) and ratified in ADR-0008. A test
-- that "computes" different numbers from the same income proves nothing
-- unless the numbers it must produce are the board's.
--
-- So this suite does four halves:
--   68.1  behaviour  -- the four January rows compute to the board's figures
--   68.2  bands      -- the 25,000 / 75,000 boundaries mean what R1 says
--   68.3  no-derive  -- intervention is copied, never auto-computed (A1)
--   68.4  pending    -- no effective version -> formula_pending with nulls
--   68.5  mechanics  -- change the config row, the output moves, no code change
--   68.6  remittance -- R4: total = MF + intervention + Faith City, area/savings
--                      excluded, per row and in aggregate
--   68.7  shape      -- uniqueness, non-negativity, period/month shapes, the
--                      submitted guard, and the §10 grant ceiling
--
-- Every amount is compared as numeric (=), never as rendered text: a
-- rendering comparison would pass or fail on formatting rather than value.

-- ---------------------------------------------------------------------------
-- Fixture. Four January branches holding the board's figures, plus a
-- pre-formula December row for 68.4. Branch ids are uuids with no FK: the
-- branches table does not exist in schema history yet (see the migration
-- header), exactly like incidents.branch_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixture_weca_branches (
  label     text PRIMARY KEY,
  branch_id uuid NOT NULL
);

DO $$
DECLARE
  v_oke uuid; v_leg uuid; v_mat uuid; v_olo uuid; v_pre uuid;
  v_rec uuid; v_ret uuid;
BEGIN
  INSERT INTO fixture_weca_branches (label, branch_id)
  VALUES ('OKE-ARO', gen_random_uuid()),
         ('LEGUN', gen_random_uuid()),
         ('MATOGUN', gen_random_uuid()),
         ('OLOMOWEWE', gen_random_uuid()),
         ('PRE-FORMULA', gen_random_uuid());

  -- OKE-ARO: E=1952150, Faith City 38000 (board row).
  SELECT branch_id INTO v_oke FROM fixture_weca_branches WHERE label = 'OKE-ARO';
  INSERT INTO branch_financial_records (branch, month, income, faith_city, currency, status)
  VALUES (v_oke, DATE '2026-01-01', 1952150.00, 38000.00, 'NGN', 'submitted')
  RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_oke, v_rec, '2026-01') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);

  -- LEGUN: E=40800, no intervention input.
  SELECT branch_id INTO v_leg FROM fixture_weca_branches WHERE label = 'LEGUN';
  INSERT INTO branch_financial_records (branch, month, income, currency, status)
  VALUES (v_leg, DATE '2026-01-01', 40800.00, 'NGN', 'submitted')
  RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_leg, v_rec, '2026-01') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);

  -- MATOGUN: E=22700, below the low band.
  SELECT branch_id INTO v_mat FROM fixture_weca_branches WHERE label = 'MATOGUN';
  INSERT INTO branch_financial_records (branch, month, income, currency, status)
  VALUES (v_mat, DATE '2026-01-01', 22700.00, 'NGN', 'submitted')
  RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_mat, v_rec, '2026-01') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);

  -- OLOMOWEWE: E=82450, intervention 8245 (the treasurer-entered 10%).
  SELECT branch_id INTO v_olo FROM fixture_weca_branches WHERE label = 'OLOMOWEWE';
  INSERT INTO branch_financial_records (branch, month, income, intervention, currency, status)
  VALUES (v_olo, DATE '2026-01-01', 82450.00, 8245.00, 'NGN', 'submitted')
  RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_olo, v_rec, '2026-01') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);

  -- PRE-FORMULA: December 2025, before weca-2026-01 is effective.
  SELECT branch_id INTO v_pre FROM fixture_weca_branches WHERE label = 'PRE-FORMULA';
  INSERT INTO branch_financial_records (branch, month, income, currency, status)
  VALUES (v_pre, DATE '2025-12-01', 100000.00, 'NGN', 'submitted')
  RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_pre, v_rec, '2025-12') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);
END $$;

-- ---------------------------------------------------------------------------
-- 68.1  BEHAVIOUR. The four January rows compute to the board's figures.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'OKE-ARO')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computation_status = 'calculated',
    'weca', 'OKE-ARO is calculated');
  PERFORM test_support.assert_equals(r.formula_version, 'weca-2026-01',
    'weca', 'OKE-ARO records the formula version used');
  PERFORM test_support.assert_true(r.computed_mf = 390430.00,
    'weca', 'OKE-ARO E=1952150 -> MF 390430.00 (20% band)');
  PERFORM test_support.assert_true(r.computed_area = 97607.50 AND r.computed_savings = 97607.50,
    'weca', 'OKE-ARO area/savings 97607.50 each (5%, retained not remitted)');
  PERFORM test_support.assert_true(r.computed_faith_city = 38000.00,
    'weca', 'OKE-ARO Faith City input passes through');
  PERFORM test_support.assert_true(r.total_due = 428430.00,
    'weca', 'OKE-ARO total = 390430 + 0 + 38000');

  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computed_mf = 4080.00,
    'weca', 'LEGUN E=40800 -> MF 4080.00 (10% band)');
  PERFORM test_support.assert_true(r.computed_area = 2040.00 AND r.computed_savings = 2040.00,
    'weca', 'LEGUN area/savings 2040.00 each');
  PERFORM test_support.assert_true(r.computed_intervention = 0,
    'weca', 'LEGUN with no intervention input contributes 0 intervention');
  PERFORM test_support.assert_true(r.total_due = 4080.00,
    'weca', 'LEGUN total = 4080 + 0 + 0');

  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'MATOGUN')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computed_mf IS NULL,
    'weca', 'MATOGUN E=22700 -> no MF line (NULL, the workbook blank)');
  PERFORM test_support.assert_true(r.computed_area = 1135.00 AND r.computed_savings = 1135.00,
    'weca', 'MATOGUN area/savings 1135.00 each');
  PERFORM test_support.assert_true(r.total_due = 0.00,
    'weca', 'MATOGUN total is 0 with no MF, no intervention, no Faith City');

  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'OLOMOWEWE')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computed_mf = 16490.00,
    'weca', 'OLOMOWEWE E=82450 -> MF 16490.00 (20% band)');
  PERFORM test_support.assert_true(r.computed_intervention = 8245.00,
    'weca', 'OLOMOWEWE intervention passthrough 8245.00 (copied, not derived)');
  PERFORM test_support.assert_true(r.total_due = 24735.00,
    'weca', 'OLOMOWEWE total = 16490 + 8245 + 0');
END $$;

-- ---------------------------------------------------------------------------
-- 68.2  BANDS. The boundaries mean what R1 says: >= 25000 earns 10%,
--        >= 75000 earns 20%, below 25000 earns no MF line. The sheet writes
--        the low ceiling as 74,999.99; with 2dp money nothing falls between
--        that and 75,000, so >= 75000 is exact.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_rec uuid;
  v_ret uuid;
  v_mf numeric;
BEGIN
  SELECT branch_id INTO v_branch FROM fixture_weca_branches WHERE label = 'LEGUN';

  -- Exactly 25,000 earns the 10% band.
  INSERT INTO branch_financial_records (branch, month, income, currency)
  VALUES (v_branch, DATE '2026-02-01', 25000.00, 'NGN') RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_branch, v_rec, '2026-02') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf = 2500.00,
    'weca', 'E=25000 earns the 10% band (MF 2500.00)');

  -- Exactly 75,000 earns the 20% band.
  INSERT INTO branch_financial_records (branch, month, income, currency)
  VALUES (v_branch, DATE '2026-03-01', 75000.00, 'NGN') RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_branch, v_rec, '2026-03') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf = 15000.00,
    'weca', 'E=75000 earns the 20% band (MF 15000.00)');

  -- The sheet's low-band ceiling 74,999.99 stays in the 10% band.
  INSERT INTO branch_financial_records (branch, month, income, currency)
  VALUES (v_branch, DATE '2026-04-01', 74999.99, 'NGN') RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_branch, v_rec, '2026-04') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf = 7500.00,
    'weca', 'E=74999.99 stays in the 10% band (MF 7500.00 after 2dp rounding)');

  -- One kobo below 25,000 earns no MF line.
  INSERT INTO branch_financial_records (branch, month, income, currency)
  VALUES (v_branch, DATE '2026-05-01', 24999.99, 'NGN') RETURNING id INTO v_rec;
  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES (v_branch, v_rec, '2026-05') RETURNING id INTO v_ret;
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf IS NULL,
    'weca', 'E=24999.99 earns no MF line');
END $$;

-- ---------------------------------------------------------------------------
-- 68.3  NO-DERIVE (A1). One row in the board's data carries intervention;
--        the rest are blank. Computing 10% for every branch would fabricate
--        liability figures, so a blank input must stay 0, however large E is.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- OKE-ARO earns almost two million and carries no intervention input.
  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'OKE-ARO')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computed_intervention = 0,
    'weca', 'intervention is NOT auto-derived: E=1952150 with no input contributes 0');

  -- And Faith City has no formula anywhere in the workbook either.
  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
     AND period = '2026-01';
  PERFORM test_support.assert_true(r.computed_faith_city = 0,
    'weca', 'Faith City is NOT auto-derived: no input contributes 0');
END $$;

-- ---------------------------------------------------------------------------
-- 68.4  PENDING. A period with no effective formula version stays
--        formula_pending with null computed fields -- the dark-ship state.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'PRE-FORMULA')
     AND period = '2025-12';
  PERFORM test_support.assert_equals(r.computation_status, 'formula_pending',
    'weca', 'a period before any effective version stays formula_pending');
  PERFORM test_support.assert_true(r.formula_version IS NULL,
    'weca', 'a pending return records no formula version');
  PERFORM test_support.assert_true(
    r.computed_mf IS NULL AND r.computed_area IS NULL AND r.computed_savings IS NULL
    AND r.computed_intervention IS NULL AND r.computed_faith_city IS NULL
    AND r.total_due IS NULL,
    'weca', 'a pending return keeps null computed fields');
END $$;

-- ---------------------------------------------------------------------------
-- 68.5  MECHANICS. Change the config row, the output moves, no code changed.
--        This is what a hard-coded engine cannot pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ret uuid;
  v_mf numeric;
BEGIN
  SELECT id INTO v_ret FROM weca_returns
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'OKE-ARO')
     AND period = '2026-01';

  -- The board revises the high-band rate: a new number in the row, no deploy.
  UPDATE weca_return_formulas
     SET rules = jsonb_set(rules, '{mf_high_rate}', '0.25')
   WHERE version = 'weca-2026-01';
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf = 488037.50,
    'weca', 'changing mf_high_rate in the config moved OKE-ARO MF to 488037.50 with no code change');

  -- Restore the ratified config and recompute back to the board figure.
  UPDATE weca_return_formulas
     SET rules = jsonb_set(rules, '{mf_high_rate}', '0.20')
   WHERE version = 'weca-2026-01';
  PERFORM weca_compute_return(v_ret);
  SELECT computed_mf INTO v_mf FROM weca_returns WHERE id = v_ret;
  PERFORM test_support.assert_true(v_mf = 390430.00,
    'weca', 'restoring the config restores the board figure (recompute is stable)');
END $$;

-- ---------------------------------------------------------------------------
-- 68.6  REMITTANCE (R4). total = MF + intervention + Faith City, per row and
--        in aggregate; area/savings are stored and excluded.
--        Fixture January aggregate:
--          MF  390430.00 + 4080.00 + 0 + 16490.00       = 411000.00
--          INT 0 + 0 + 0 + 8245.00                       = 8245.00
--          FC  38000.00 + 0 + 0 + 0                      = 38000.00
--          remittance                                     = 457245.00
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mf numeric; v_int numeric; v_fc numeric;
  v_tot numeric; v_area numeric;
BEGIN
  SELECT COALESCE(sum(computed_mf), 0),
         sum(computed_intervention), sum(computed_faith_city),
         sum(total_due), sum(computed_area)
    INTO v_mf, v_int, v_fc, v_tot, v_area
    FROM weca_returns WHERE period = '2026-01';

  PERFORM test_support.assert_true(v_mf = 411000.00,
    'weca', 'January fixture MF aggregate is 411000.00');
  PERFORM test_support.assert_true(v_int = 8245.00,
    'weca', 'January fixture intervention aggregate is 8245.00');
  PERFORM test_support.assert_true(v_fc = 38000.00,
    'weca', 'January fixture Faith City aggregate is 38000.00');
  PERFORM test_support.assert_true(v_tot = 457245.00,
    'weca', 'January fixture remittance aggregate is 457245.00');
  PERFORM test_support.assert_true(v_tot = v_mf + v_int + v_fc,
    'weca', 'the aggregation formula holds: total = MF + intervention + Faith City');
  PERFORM test_support.assert_true(v_area = 104905.00,
    'weca', 'January fixture area aggregate is 104905.00, stored and excluded from the remittance');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM weca_returns
      WHERE period = '2026-01'
        AND total_due = COALESCE(computed_mf, 0) + computed_intervention + computed_faith_city) = 4,
    'weca', 'R4 holds on every January row, not just in aggregate');
END $$;

-- ---------------------------------------------------------------------------
-- 68.7  SHAPE. Uniqueness, non-negativity, period/month shapes, the submitted
--        guard, and the §10 grant ceiling (amounts writable as inputs;
--        computed lines never hand-edited; formulas read-only to the app).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT branch_id INTO v_branch FROM fixture_weca_branches WHERE label = 'LEGUN';

  -- One record per branch-month.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO branch_financial_records (branch, month, income)
      SELECT branch, month, income FROM branch_financial_records
       WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
         AND month = DATE '2026-01-01'$q$,
    '23505', 'weca', 'a second record for one branch-month is refused');

  -- One return per branch-period.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO weca_returns (branch, financial_record, period)
      SELECT branch, financial_record, period FROM weca_returns
       WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
         AND period = '2026-01'$q$,
    '23505', 'weca', 'a second return for one branch-period is refused');

  -- Money is never negative.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO branch_financial_records (branch, month, income)
      VALUES ('00000000-0000-0000-0000-000000000000', DATE '2026-06-01', -1.00)$q$,
    '23514', 'weca', 'a negative income is refused');

  -- The month is the first of the month, not a day.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO branch_financial_records (branch, month, income)
      VALUES ('00000000-0000-0000-0000-000000000000', DATE '2026-06-15', 100.00)$q$,
    '23514', 'weca', 'a mid-month date is refused');

  -- The period is YYYY-MM, not anything else.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO weca_returns (branch, period)
      VALUES ('00000000-0000-0000-0000-000000000000', '2026-13')$q$,
    '23514', 'weca', 'a non-calendar period is refused');

  -- A submitted return is not recomputed in place. The status flip below
  -- persists (it is outside the probe); the recompute attempt is the probe,
  -- so the guard's refusal rolls back and the reset afterwards restores the
  -- fixture to calculated.
  UPDATE weca_returns SET computation_status = 'submitted'
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
     AND period = '2026-01';

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT weca_compute_return((SELECT id FROM weca_returns
       WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
         AND period = '2026-01'))$q$,
    '23001', 'weca', 'recomputing a submitted return is refused');

  UPDATE weca_returns SET computation_status = 'calculated'
   WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
     AND period = '2026-01';

  -- §10 ceiling: the app reads formulas but never writes them.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO weca_return_formulas (version, effective_from, rules)
      VALUES ('weca-2099-01', DATE '2099-01-01', '{"mf_low_min": 1}'::jsonb)$q$,
    '42501', 'weca', 'the app cannot insert a formula version (board-ratified config lands as a reviewed row)');

  -- §10 ceiling: computed lines are never hand-edited through the app.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE weca_returns SET computed_mf = 1.00
      WHERE branch = (SELECT branch_id FROM fixture_weca_branches WHERE label = 'LEGUN')
        AND period = '2026-01'$q$,
    '42501', 'weca', 'the app cannot hand-edit a computed line');

  -- §10 floor: the app CAN capture inputs and read the schedule.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO branch_financial_records (branch, month, income, currency)
      VALUES ('00000000-0000-0000-0000-000000000000', DATE '2026-07-01', 50000.00, 'NGN')$q$,
    'weca', 'the app can capture a financial input record');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT 1 FROM weca_return_formulas WHERE version = 'weca-2026-01'$q$,
    'weca', 'the app can read the formula schedule');
END $$;
