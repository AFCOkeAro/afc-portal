import { periodSchema } from '@afc/shared/weca'
import { collectFinanceCompare, collectFinanceSummary } from '../../utils/weca-summary'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/finance/summary?period=YYYY-MM[&compare_prior_year=true] — the
 * monthly board-sheet summary (AFC-475, US-F2 AC2). Reads the same collector
 * the returns CSV exports, so the page and the file agree by construction.
 *
 * US-A4 compare (AFC-485): `compare_prior_year=true` adds the same month one
 * year back with a remittance delta.
 */
export default defineEventHandler(async (event) => {
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
  const compare = await collectFinanceCompare(event, scope, period, summary)
  return { data: { ...summary, compare } }
})
