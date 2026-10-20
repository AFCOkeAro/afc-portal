import {
  celebrationFeedFilters,
  celebrationSortParam,
  collectCelebrations,
} from '../../utils/celebration-feed'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/celebrations?branch=&zone=&type=&visibility=&status=
 *   &month=&day=&date_from=&date_to=&sort=&page=&limit=
 *
 * Hierarchy-scoped celebrations feed (AFC-476, US-Y2/US-Y3). Filters, the
 * recurring month/day handling and sort all flow through the shared
 * collector, which is the same read the CSV export, the calendar
 * contribution and the profile roll-up use -- the four cannot drift.
 * A (month, day) pair selects recurring greetings falling on that
 * month/day; a date range selects dated shout-outs.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'read')

  const filters = celebrationFeedFilters(event)
  const { rows, total } = await collectCelebrations(event, scope, filters)

  // The collector reads the whole filtered set (the export and the
  // calendar need it); the list route paginates the window. Same rows,
  // same order.
  const start = (filters.page - 1) * filters.limit
  return {
    data: rows.slice(start, start + filters.limit),
    meta: { total, page: filters.page, limit: filters.limit },
    filters: {
      branch: filters.branch,
      zone: filters.zone,
      type: filters.type,
      visibility: filters.visibility,
      status: filters.status,
      month: filters.month,
      day: filters.day,
      date_from: filters.date_from,
      date_to: filters.date_to,
      sort: celebrationSortParam(filters.sort),
    },
  }
})
