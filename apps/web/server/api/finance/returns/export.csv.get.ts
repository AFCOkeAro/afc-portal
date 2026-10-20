import { periodSchema } from '@afc/shared/weca'
import { collectFinanceSummary } from '../../../utils/weca-summary'
import { csvResponse, getPortalScope, requireCan } from '../../../utils/portal'

/**
 * Returns CSV (AFC-475, US-F3). Serialises the same `collectFinanceSummary`
 * aggregate the summary page renders -- the export and the page cannot drift.
 * Computed columns carry values only when the caller's grants reveal them
 * (§11.1); otherwise the cell reads `pending` for a formula-pending line or
 * `restricted` for a line the caller may not see amounts of. Nothing is
 * zero-filled: a pending line exports no figures at all.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_returns', 'read')

  const query = getQuery(event)
  const period = typeof query.period === 'string' ? query.period : ''
  if (!periodSchema.safeParse(period).success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A YYYY-MM period is required',
      data: { code: 'period_required' },
    })
  }

  const summary = await collectFinanceSummary(event, scope, period)
  if (summary.lines.length > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That export is too large. Narrow the scope, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  const amount = (value: string | null, pending: boolean): string => {
    if (value !== null) return value
    return pending ? 'pending' : 'restricted'
  }

  const rows: string[][] = [
    [
      'branch',
      'period',
      'computation_status',
      'formula_version',
      'computed_mf',
      'computed_intervention',
      'computed_faith_city',
      'total_due',
      'area_retained',
      'savings_retained',
    ],
    ...summary.lines.map((line) => {
      const pending = line.computation_status === 'formula_pending'
      return [
        line.branch_name ?? line.branch,
        summary.period,
        line.computation_status,
        line.formula_version ?? '',
        amount(line.mf, pending),
        amount(line.intervention, pending),
        amount(line.faith_city, pending),
        amount(line.total, pending),
        amount(line.area_retained, pending),
        amount(line.savings_retained, pending),
      ]
    }),
  ]

  return csvResponse(event, `weca-returns-${period}.csv`, rows)
})
