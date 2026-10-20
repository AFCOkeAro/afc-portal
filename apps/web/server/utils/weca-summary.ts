import type { H3Event } from 'h3'
import type { FinanceSummary, FinanceSummaryLine, WecaReturnRow } from '../../types/finance'
import {
  branchNames,
  listItems,
  mergeFilters,
  scopeFilter,
  visibleFields,
  type PortalScope,
} from './portal'

const RETURN_FIELDS = [
  'id',
  'branch',
  'financial_record',
  'period',
  'computation_status',
  'formula_version',
  'computed_mf',
  'computed_area',
  'computed_savings',
  'computed_intervention',
  'computed_faith_city',
  'total_due',
  'generated_at',
  'submitted_at',
  'confirmed_at',
]

const MAX_SUMMARY_ROWS = 5000

function toDecimal(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toMoney(value: number): string {
  return value.toFixed(2)
}

/**
 * Monthly board-sheet summary (AFC-475, ADR-0008 R4).
 *
 * The sheet's `TOTAL REMITTANCE DUE = MF + intervention + Faith City` is
 * re-derived here from the normalized `(branch, period)` lines, never stored
 * as a second number that could disagree with the lines. Area/savings lines
 * are shown separately as retained (R2): they never enter the remittance.
 *
 * Two deliberate non-computations:
 * - A `formula_pending` line (or any line whose computed fields are null)
 *   contributes nothing to the totals and is counted in `pending`, not
 *   zero-filled. Zero-filling would present "no formula yet" as "owes
 *   nothing", which is a fabricated dues figure (risk lens: one-way door).
 * - Amounts are aggregated only when the caller's grants reveal computed
 *   fields (§11.1: area+). Otherwise totals are null and `amounts_visible`
 *   is false; the caller still sees counts and pending flags.
 *
 * The JSON summary route and the returns CSV route both read this collector
 * with the same period and the same scope, so the export cannot drift from
 * the page (welfare-report.ts precedent).
 */
export async function collectFinanceSummary(
  event: H3Event,
  scope: PortalScope,
  period: string,
): Promise<FinanceSummary> {
  const amountsVisible = visibleFields(scope, 'weca_returns', ['total_due']).includes(
    'total_due',
  )

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    {
      filter: mergeFilters({ period: { _eq: period } }, scopeFilter(scope)),
      fields: visibleFields(scope, 'weca_returns', RETURN_FIELDS),
      sort: 'branch',
      limit: MAX_SUMMARY_ROWS,
    },
  )

  if (result.meta.total > MAX_SUMMARY_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That period has too many return lines for one summary. Narrow the scope, then try again.',
      data: { code: 'range_too_large' },
    })
  }

  const names = await branchNames(event, scope)

  let pending = 0
  let mfTotal = 0
  let interventionTotal = 0
  let faithCityTotal = 0
  let remittanceTotal = 0
  let areaTotal = 0
  let savingsTotal = 0
  const versions = new Set<string>()

  const lines: FinanceSummaryLine[] = result.data.map((row) => {
    const record = row as unknown as WecaReturnRow
    const status = record.computation_status
    if (record.formula_version) versions.add(record.formula_version)

    const mf = toDecimal(record.computed_mf)
    const intervention = toDecimal(record.computed_intervention)
    const faithCity = toDecimal(record.computed_faith_city)
    const total = toDecimal(record.total_due)
    const area = toDecimal(record.computed_area)
    const savings = toDecimal(record.computed_savings)
    const settled =
      amountsVisible &&
      status !== 'formula_pending' &&
      mf !== null &&
      intervention !== null &&
      faithCity !== null &&
      total !== null
    if (!settled) pending += 1
    else {
      mfTotal += mf as number
      interventionTotal += intervention as number
      faithCityTotal += faithCity as number
      remittanceTotal += total as number
      areaTotal += area ?? 0
      savingsTotal += savings ?? 0
    }

    return {
      branch: String(record.branch ?? ''),
      branch_name: record.branch ? (names.get(String(record.branch)) ?? null) : null,
      computation_status: status,
      formula_version: record.formula_version ?? null,
      mf: settled ? toMoney(mf as number) : null,
      intervention: settled ? toMoney(intervention as number) : null,
      faith_city: settled ? toMoney(faithCity as number) : null,
      total: settled ? toMoney(total as number) : null,
      area_retained: settled && area !== null ? toMoney(area) : null,
      savings_retained: settled && savings !== null ? toMoney(savings) : null,
    }
  })

  const branchCount = new Set(lines.map((line) => line.branch)).size

  return {
    period,
    amounts_visible: amountsVisible,
    branches: branchCount,
    pending,
    mf_total: amountsVisible ? toMoney(mfTotal) : null,
    intervention_total: amountsVisible ? toMoney(interventionTotal) : null,
    faith_city_total: amountsVisible ? toMoney(faithCityTotal) : null,
    remittance_total: amountsVisible ? toMoney(remittanceTotal) : null,
    area_retained_total: amountsVisible ? toMoney(areaTotal) : null,
    savings_retained_total: amountsVisible ? toMoney(savingsTotal) : null,
    versions: [...versions].sort(),
    lines,
  }
}
