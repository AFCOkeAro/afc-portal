-- 20261020_0001_weca_returns.sql
--
-- WECA returns capture + formula v1 computation. AFC-451, spec authority
-- docs/adr/ADR-0007-weca-returns-formula-v1.md (board answer cb89849b).
-- Finance scope only: no youth/camp identifiers appear in this file.
--
-- DEVIATION FROM docs/planning/data-model-expansion.md §5 (recorded, not silent):
-- the doc's `weca_contribution` / `savings_projects_5pct` INPUT columns on
-- branch_financial_records are superseded. Per ADR-0007 R1-R3 the MF line and
-- both 5% lines are COMPUTED from income, never captured, so storing them as
-- inputs would fork the source of truth (a treasurer-typed MF beside a
-- computed MF, with no rule for which one the remittance uses). The inputs are
-- income, intervention, and faith_city only; MF / area / savings arrive as
-- computed columns on weca_returns.
--
-- BRANCH REFERENCE WITHOUT A FOREIGN KEY (deliberate, smallest option):
-- the `branches` collection does not exist anywhere in this schema history yet
-- (verified: no branches table in services/directus/schema/migrations/), so
-- there is no referent to point a REFERENCES clause at. `branch` is therefore
-- a uuid naming the Directus `branches` row, exactly like
-- `incidents.branch_id` in 20261006_0001. The data-model migration that creates
-- `branches` must ALTER these tables to add the FK; it must not fork them.
--
-- CURRENCY v1: NGN only. ADR-0007 leaves conversion out of scope; the CHECK
-- below pins that so a multi-currency row cannot be stored and silently
-- summed as naira.
--
-- Rollback: rollback/20261020_0001_weca_returns.down.sql (refuses while any
-- captured row exists; drops tables + function, additive-only forward).
-- Owner: migration role (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0004
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
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
-- 1. branch_financial_records -- the treasurer's captured inputs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_financial_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- M2O branches. No REFERENCES: branches does not exist in schema history
  -- yet (see header). Named `branch` to match the Directus field name the
  -- data-model migration will land.
  branch        uuid NOT NULL,
  -- First day of the month. The day is not data; pinning it stops the same
  -- branch-month arriving as two rows under two different days.
  month         date NOT NULL
                  CHECK (month = date_trunc('month', month)::date),
  -- Tithe & offering income E (NGN). One figure; decomposition is out of scope.
  income        numeric(14,2) NOT NULL CHECK (income >= 0),
  -- Manual treasurer inputs, NOT derived (ADR-0007 R3/A1). Nullable in,
  -- default 0 in the total.
  intervention  numeric(14,2) CHECK (intervention >= 0),
  faith_city    numeric(14,2) CHECK (faith_city >= 0),
  currency      text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'confirmed')),
  submitted_by  uuid,
  confirmed_by  uuid,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_financial_records_branch_month_key UNIQUE (branch, month)
);

COMMENT ON TABLE branch_financial_records IS
  'Per-branch monthly finance capture (ADR-0007). Inputs only: income, intervention, faith_city. MF and both 5% lines are computed on weca_returns, never stored here. branch has no FK until the data-model migration creates branches.';

CREATE INDEX IF NOT EXISTS branch_financial_records_status_idx
  ON branch_financial_records (status);

-- ---------------------------------------------------------------------------
-- 2. weca_return_formulas -- the versioned board config (ADR-0007 R5/A3).
--
-- Rates and thresholds live in `rules`, never in a function body: a future
-- board revision is a new version row, not a code deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weca_return_formulas (
  version        text PRIMARY KEY,
  effective_from date NOT NULL,
  rules          jsonb NOT NULL
                   CHECK (rules ?& array[
                     'mf_low_min', 'mf_high_min',
                     'mf_low_rate', 'mf_high_rate',
                     'area_rate', 'savings_rate'
                   ]),
  notes          text
);

COMMENT ON TABLE weca_return_formulas IS
  'Board-ratified WECA formula versions. Config, not code: weca_compute_return reads the effective row; nothing hard-codes a rate. Versions are immutable -- supersede with a new row, never UPDATE.';

-- SEED: the single board-ratified config, not a plausible default.
-- Source: ADR-0007 + board answer cb89849b (human-only resolver,
-- server-verified) on the January-September 2026 Lagos North workbook.
-- No other version is seeded: with no effective row a return stays
-- formula_pending with null computed fields (dark-ship precedent, 0004).
INSERT INTO weca_return_formulas (version, effective_from, rules, notes)
VALUES (
  'weca-2026-01',
  DATE '2026-01-01',
  '{"mf_low_min": 25000, "mf_high_min": 75000, "mf_low_rate": 0.10, "mf_high_rate": 0.20, "area_rate": 0.05, "savings_rate": 0.05}'::jsonb,
  'Board-ratified formula v1 per ADR-0007 (answer cb89849b): MF bands 10%/20% at 25000/75000, area 5% + savings 5% retained (not remitted), intervention + Faith City manual inputs, total = MF + intervention + Faith City.'
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. weca_returns -- one computed return per (branch, period).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weca_returns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch                uuid NOT NULL,
  financial_record      uuid REFERENCES branch_financial_records(id),
  period                text NOT NULL
                          CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  computation_status    text NOT NULL DEFAULT 'formula_pending'
                          CHECK (computation_status IN
                            ('formula_pending', 'calculated', 'submitted', 'confirmed')),
  formula_version       text REFERENCES weca_return_formulas(version),
  -- Nullable while formula_pending; populated by weca_compute_return().
  computed_mf           numeric(14,2) CHECK (computed_mf >= 0),
  computed_area         numeric(14,2) CHECK (computed_area >= 0),
  computed_savings      numeric(14,2) CHECK (computed_savings >= 0),
  computed_intervention numeric(14,2) CHECK (computed_intervention >= 0),
  computed_faith_city   numeric(14,2) CHECK (computed_faith_city >= 0),
  total_due             numeric(14,2) CHECK (total_due >= 0),
  generated_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at          timestamptz,
  confirmed_at          timestamptz,
  generated_by          uuid,
  CONSTRAINT weca_returns_branch_period_key UNIQUE (branch, period)
);

COMMENT ON TABLE weca_returns IS
  'Computed WECA return per (branch, period) (ADR-0007 R1-R5). computed_* stay NULL while computation_status = formula_pending. total_due = mf + intervention + faith_city; area/savings are stored but never remitted.';

CREATE INDEX IF NOT EXISTS weca_returns_status_idx
  ON weca_returns (computation_status);

-- ---------------------------------------------------------------------------
-- 4. weca_compute_return -- the R1-R4 arithmetic.
--
-- WHY A SQL FUNCTION AND NOT A SERVER MODULE (cheapest total-cost answer):
-- the computation is pure arithmetic over two rows in this database, it runs
-- exactly where the data already is (no new endpoint, Flow, dependency, or
-- deploy to operate), and it is directly assertable by tests/db, which is the
-- only harness this repo runs. A Directus Flow or extension would add an
-- unaudited runtime surface for zero new capability.
--
-- CONFIG-DRIVEN (ADR-0007 A3): every rate and threshold below is read from the
-- effective weca_return_formulas row. The function body names only the KEY
-- names, never a number; changing a number is a row change, and the 68 suite
-- proves it by changing the row and watching the output move with no code change.
--
-- EFFECTIVE VERSION: the row with the greatest effective_from on or before
-- the source record's month. Period-based (not now()-based) so recomputing
-- history after a revision lands uses the version that was in force then.
-- With no effective row the return is left formula_pending with nulls.
--
-- ROUNDING (R6): each output line rounded to 2dp. round(numeric, 2) rounds
-- half away from zero, which is half-up for non-negative money.
--
-- NO-MF-LINE (R1): E below the low band stores computed_mf = NULL, mirroring
-- the workbook's blank cell (the 68 suite accepts null/0 per the issue).
-- intervention/faith_city store COALESCE(input, 0): "nullable in, default 0
-- in the total", and a NULL there must read as contributes-0, not unknown.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION weca_compute_return(p_return_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_return  weca_returns%ROWTYPE;
  v_record  branch_financial_records%ROWTYPE;
  v_rules   jsonb;
  v_version text;
  v_low_min  numeric;
  v_high_min numeric;
  v_low_rate  numeric;
  v_high_rate numeric;
  v_area_rate numeric;
  v_sav_rate  numeric;
  v_mf  numeric(14,2);
  v_area numeric(14,2);
  v_sav  numeric(14,2);
  v_int  numeric(14,2);
  v_fc   numeric(14,2);
BEGIN
  SELECT * INTO v_return FROM weca_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'weca_compute_return: return % does not exist', p_return_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_return.computation_status NOT IN ('formula_pending', 'calculated') THEN
    RAISE EXCEPTION
      'weca_compute_return: return % is %, and a submitted/confirmed return is not recomputed in place. Correct it with a reviewed step, not a silent recalculation.',
      p_return_id, v_return.computation_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO v_record
    FROM branch_financial_records WHERE id = v_return.financial_record;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'weca_compute_return: return % has no source financial record', p_return_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT f.version, f.rules INTO v_version, v_rules
    FROM weca_return_formulas f
   WHERE f.effective_from <= v_record.month
   ORDER BY f.effective_from DESC, f.version DESC
   LIMIT 1;

  -- No effective version: the dark-ship state. Nulls, pending, version unset.
  IF v_version IS NULL THEN
    UPDATE weca_returns
       SET computation_status = 'formula_pending',
           formula_version = NULL,
           computed_mf = NULL, computed_area = NULL, computed_savings = NULL,
           computed_intervention = NULL, computed_faith_city = NULL,
           total_due = NULL
     WHERE id = p_return_id;
    RETURN;
  END IF;

  v_low_min   := (v_rules->>'mf_low_min')::numeric;
  v_high_min  := (v_rules->>'mf_high_min')::numeric;
  v_low_rate  := (v_rules->>'mf_low_rate')::numeric;
  v_high_rate := (v_rules->>'mf_high_rate')::numeric;
  v_area_rate := (v_rules->>'area_rate')::numeric;
  v_sav_rate  := (v_rules->>'savings_rate')::numeric;

  IF v_low_min IS NULL OR v_high_min IS NULL
     OR v_low_rate IS NULL OR v_high_rate IS NULL
     OR v_area_rate IS NULL OR v_sav_rate IS NULL THEN
    RAISE EXCEPTION
      'weca_compute_return: formula version % has an incomplete rules object', v_version
      USING ERRCODE = 'check_violation';
  END IF;

  -- R1: MF band. Below the low band there is no MF line (NULL, not 0).
  IF v_record.income >= v_high_min THEN
    v_mf := round(v_record.income * v_high_rate, 2);
  ELSIF v_record.income >= v_low_min THEN
    v_mf := round(v_record.income * v_low_rate, 2);
  ELSE
    v_mf := NULL;
  END IF;

  -- R2: area + savings retained, never remitted. E > 0 gates the lines; at
  -- E = 0 the product is 0 either way, so no special case is needed.
  v_area := round(v_record.income * v_area_rate, 2);
  v_sav  := round(v_record.income * v_sav_rate, 2);

  -- R3: treasurer inputs copied, never derived. NULL in reads as 0 out.
  v_int := COALESCE(v_record.intervention, 0);
  v_fc  := COALESCE(v_record.faith_city, 0);

  UPDATE weca_returns
     SET computation_status = 'calculated',
         formula_version = v_version,
         computed_mf = v_mf,
         computed_area = v_area,
         computed_savings = v_sav,
         computed_intervention = v_int,
         computed_faith_city = v_fc,
         -- R4: area/savings excluded, per the workbook's own SUM.
         total_due = round(COALESCE(v_mf, 0) + v_int + v_fc, 2)
   WHERE id = p_return_id;
END
$$;

COMMENT ON FUNCTION weca_compute_return(uuid) IS
  'ADR-0007 R1-R4. Reads rates/thresholds from the effective weca_return_formulas row (period-based); never hard-codes a number. No effective version -> formula_pending with nulls.';

-- ---------------------------------------------------------------------------
-- 5. Least privilege (data-model-expansion.md §10, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- the branch-admin-own / area+ / finance-lead scoping in §10 lives in the
-- Directus policy layer (filters + field rules), not here -- a GRANT cannot
-- express "own branch". What this layer states is the ceiling:
--   branch_financial_records amounts: writable inputs (INSERT/UPDATE on input
--     columns + lifecycle status), no DELETE -- a captured record is audited
--     (prd-expansion US-F1 AC2) and does not disappear through the API.
--   weca_returns: computed lines are read + lifecycle-managed, never
--     hand-edited (a hand-set computed_mf is a fabricated liability figure);
--     only status/submitted_at/confirmed_at are writable.
--   weca_return_formulas: read-only to the app. Versions are board-ratified
--     config and land as reviewed migration rows (A3), never as app writes.
-- ---------------------------------------------------------------------------
GRANT SELECT ON weca_return_formulas TO directus_app;

GRANT SELECT ON branch_financial_records TO directus_app;
GRANT INSERT (
  branch, month, income, intervention, faith_city, currency, status, notes
) ON branch_financial_records TO directus_app;
GRANT UPDATE (
  branch, month, income, intervention, faith_city, currency, status,
  submitted_by, confirmed_by, notes, updated_at
) ON branch_financial_records TO directus_app;

GRANT SELECT ON weca_returns TO directus_app;
GRANT INSERT (branch, financial_record, period, generated_by) ON weca_returns TO directus_app;
GRANT UPDATE (
  computation_status, submitted_at, confirmed_at, generated_by
) ON weca_returns TO directus_app;

REVOKE ALL ON branch_financial_records FROM PUBLIC;
REVOKE ALL ON weca_returns FROM PUBLIC;
REVOKE ALL ON weca_return_formulas FROM PUBLIC;
