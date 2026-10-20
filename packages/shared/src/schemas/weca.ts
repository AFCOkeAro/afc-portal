/**
 * WECA finance capture (AFC-451, ADR-0007).
 *
 * A form sends what the treasurer typed, which is not the row: income arrives
 * as a decimal string (Postgres `numeric(14,2)` is not a float), the month as
 * a `YYYY-MM-DD` date pinned to the first of the month, and the period as
 * `YYYY-MM` text.
 *
 * Deliberately absent: any TypeScript copy of the R1-R4 arithmetic. The
 * computation lives in exactly one place -- `weca_compute_return()` in
 * `20261020_0001_weca_returns.sql`, reading the effective
 * `weca_return_formulas` row. A second implementation here would drift from
 * the first the way every duplicated formula does, and ADR-0007 A3 rejects
 * hard-coded rates anywhere outside the versioned config row.
 */
import { z } from 'zod'
import { dateSchema, moneySchema, optionalNote, uuidSchema } from './common'

/** v1 is naira-only; the CHECK in the migration pins the same. */
const WECA_CURRENCIES = ['NGN'] as const

const FINANCIAL_STATUSES = ['draft', 'submitted', 'confirmed'] as const

const COMPUTATION_STATUSES = [
  'formula_pending',
  'calculated',
  'submitted',
  'confirmed',
] as const

/** `YYYY-MM`, the wire format for a return `period`. */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a YYYY-MM period')

/** First day of the month, the wire format for a record `month`. */
export const monthSchema = dateSchema.refine(
  (value) => value.endsWith('-01'),
  'Expected the first day of the month',
)

/** Income is required and never negative; the regex already excludes `-`. */
export const requiredMoneySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Expected a decimal amount with at most two places')

/**
 * Treasurer capture. Intervention and Faith City are manual inputs that
 * default to 0 in the total (ADR-0007 R3) -- hence `moneySchema`, which
 * normalises `""` to null rather than failing the form.
 */
export const financialRecordFormSchema = z.object({
  branch: uuidSchema,
  month: monthSchema,
  income: requiredMoneySchema,
  intervention: moneySchema,
  faith_city: moneySchema,
  currency: z.enum(WECA_CURRENCIES).default('NGN'),
  status: z.enum(FINANCIAL_STATUSES).default('draft'),
  notes: optionalNote(),
})

export type FinancialRecordForm = z.infer<typeof financialRecordFormSchema>
export type FinancialRecordFormInput = z.input<typeof financialRecordFormSchema>

export function toFinancialRecordPayload(
  form: FinancialRecordForm,
): Record<string, unknown> {
  return {
    branch: form.branch,
    month: form.month,
    income: form.income,
    intervention: form.intervention,
    faith_city: form.faith_city,
    currency: form.currency,
    status: form.status,
    notes: form.notes ?? null,
  }
}

/**
 * A computed return as the UI reads it. Computed lines are nullable because
 * a `formula_pending` return has none yet; the UI shows "pending board
 * formula" for those, never a guessed figure.
 */
export const wecaReturnSchema = z.object({
  branch: uuidSchema,
  financial_record: uuidSchema,
  period: periodSchema,
  computation_status: z.enum(COMPUTATION_STATUSES).default('formula_pending'),
  formula_version: z.string().trim().max(60).optional(),
  computed_mf: moneySchema,
  computed_area: moneySchema,
  computed_savings: moneySchema,
  computed_intervention: moneySchema,
  computed_faith_city: moneySchema,
  total_due: moneySchema,
})

export type WecaReturn = z.infer<typeof wecaReturnSchema>

/** One board-ratified formula version. Rates arrive as numbers, not strings. */
export const wecaFormulaRulesSchema = z.object({
  mf_low_min: z.number(),
  mf_high_min: z.number(),
  mf_low_rate: z.number(),
  mf_high_rate: z.number(),
  area_rate: z.number(),
  savings_rate: z.number(),
})

export type WecaFormulaRules = z.infer<typeof wecaFormulaRulesSchema>

export const wecaFormulaSchema = z.object({
  version: z.string().trim().min(1, 'Version is required').max(60),
  effective_from: dateSchema,
  rules: wecaFormulaRulesSchema,
  notes: optionalNote(),
})

export type WecaFormula = z.infer<typeof wecaFormulaSchema>
