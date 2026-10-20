import {
  COACHING_PROGRAMME_FIELDS,
  coachingProgrammeScopeFilter,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/programmes?branch=&zone=&exam=&status=
 *
 * Coaching programmes (AFC-484, US-C1 AC3). Scope resolves on the
 * programme's own area/zone/branch columns: area-wide rows (all null) are
 * visible to every scoped session; branch staff see their branches plus
 * area-wide rows. Out-of-scope branch/zone filters are 403 (fail-closed).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_programmes', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const filter = await coachingProgrammeScopeFilter(event, scope, {
    branch: text('branch'),
    zone: text('zone'),
  })

  const { mergeFilters } = await import('../../../utils/portal')
  const exam = text('exam')
  const status = text('status')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_programmes',
    {
      filter: mergeFilters(
        filter,
        exam ? { exam: { _eq: exam } } : undefined,
        status ? { status: { _eq: status } } : undefined,
      ),
      fields: COACHING_PROGRAMME_FIELDS,
      sort: '-created_at',
      page,
      limit,
    },
  )

  return {
    data: result.data,
    meta: { total: result.meta.total, page, limit },
  }
})
