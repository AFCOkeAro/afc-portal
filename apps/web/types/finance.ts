/**
 * WECA finance surface (AFC-475, ADR-0008). Kept beside `portal.ts` rather
 * than inside it so the slice lands without touching the shared portal
 * types file while sibling slices have uncommitted hunks in it.
 *
 * Amount columns arrive as decimal strings (Postgres `numeric(14,2)` is not
 * a float); computed lines are nullable because a `formula_pending` return
 * has none yet. The UI renders those as "pending board formula", never as a
 * guessed figure.
 */
export interface FinancialRecordRow {
  id: string
  branch: string | null
  branch_name: string | null
  month: string
  income: string | null
  intervention: string | null
  faith_city: string | null
  currency: string | null
  status: 'draft' | 'submitted' | 'confirmed'
  submitted_by: string | null
  confirmed_by: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type ComputationStatus =
  | 'formula_pending'
  | 'calculated'
  | 'submitted'
  | 'confirmed'

export interface WecaReturnRow {
  id: string
  branch: string | null
  branch_name: string | null
  financial_record: string | null
  record_month: string | null
  period: string
  computation_status: ComputationStatus
  formula_version: string | null
  computed_mf: string | null
  computed_area: string | null
  computed_savings: string | null
  computed_intervention: string | null
  computed_faith_city: string | null
  total_due: string | null
  generated_at: string | null
  submitted_at: string | null
  confirmed_at: string | null
}

/**
 * One board-ratified formula version. `rules` is the versioned config row;
 * the portal renders it human-readable but never computes from it -- the
 * only computation lives in `weca_compute_return()` (ADR-0008 A3).
 */
export interface WecaFormulaRow {
  version: string
  effective_from: string
  rules: {
    mf_low_min: number
    mf_high_min: number
    mf_low_rate: number
    mf_high_rate: number
    area_rate: number
    savings_rate: number
  }
  notes: string | null
}

/** One branch line of the monthly board-sheet summary, from normalized rows. */
export interface FinanceSummaryLine {
  branch: string
  branch_name: string | null
  computation_status: ComputationStatus
  /** The board formula version the line computed under; null while pending. */
  formula_version: string | null
  /** Null while the line is pending or its amounts are hidden from the caller. */
  mf: string | null
  intervention: string | null
  faith_city: string | null
  total: string | null
  area_retained: string | null
  savings_retained: string | null
}

export interface FinanceSummary {
  period: string
  /** False when the caller's grants hide computed fields (§11.1). */
  amounts_visible: boolean
  branches: number
  pending: number
  mf_total: string | null
  intervention_total: string | null
  faith_city_total: string | null
  /** MF + intervention + Faith City; area/savings are retained, never remitted. */
  remittance_total: string | null
  area_retained_total: string | null
  savings_retained_total: string | null
  versions: string[]
  lines: FinanceSummaryLine[]
}
