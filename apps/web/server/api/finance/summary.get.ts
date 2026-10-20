import { periodSchema } from '@afc/shared/weca'
import { collectFinanceSummary } from '../../utils/weca-summary'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/finance/summary?period=YYYY-MM — the monthly board-sheet summary
 * (AFC-475, US-F2 AC2). Reads the same collector the returns CSV exports,
 * so the page and the file agree by construction.
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

  return { data: await collectFinanceSummary(event, scope, period) }
})
