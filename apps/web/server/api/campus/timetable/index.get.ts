import { COACHING_TIMETABLE_FIELDS, programmeChildFilter } from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/timetable?programme=&day_of_week=
 *
 * Coaching timetable slots (AFC-484, US-C1 AC3). Slots carry no scope
 * columns of their own: visibility resolves through the parent programme
 * (area-wide programmes are visible to every scoped session). A programme
 * filter outside the caller's visible set returns empty, never foreign rows.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_timetable', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const programme = text('programme')
  const day = text('day_of_week')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  const scopeFilter = await programmeChildFilter(event, scope)

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_timetable',
    {
      filter: mergeFilters(
        scopeFilter,
        programme ? { programme: { _eq: programme } } : undefined,
        day ? { day_of_week: { _eq: day } } : undefined,
      ),
      fields: COACHING_TIMETABLE_FIELDS,
      sort: 'day_of_week,start_time',
      page,
      limit,
    },
  )

  return {
    data: result.data,
    meta: { total: result.meta.total, page, limit },
  }
})
