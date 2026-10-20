import {
  CAMPUS_SUPPORT_FIELDS,
  campusOutcomeScopeFilter,
  stripSupportMany,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/support?student=&status=
 *
 * Financial support records (AFC-484, US-C4 AC2/AC3). Scope resolves
 * through the student branch/zone (programme is nullable — support
 * outlives a programme cycle). Amounts are stripped per the role matrix
 * (§11.1) before rows leave the server.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_financial_support', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const student = text('student')
  const status = text('status')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const scopeFilter = campusOutcomeScopeFilter(scope, ['student'])

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'campus_financial_support',
    {
      filter: mergeFilters(
        scopeFilter,
        student ? { student: { _eq: student } } : undefined,
        status ? { status: { _eq: status } } : undefined,
      ),
      fields: CAMPUS_SUPPORT_FIELDS,
      sort: '-support_date',
      page,
      limit,
    },
  )

  return {
    data: stripSupportMany(scope, result.data),
    meta: { total: result.meta.total, page, limit },
  }
})
