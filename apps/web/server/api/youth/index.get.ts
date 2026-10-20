import { collectYouth, youthFilters, youthSortParam } from '../../utils/youth-feed'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/youth?branch=&zone=&education_level=&employment_status=
 *   &is_entrepreneur=&status=&sort=&page=&limit=
 *
 * Hierarchy-scoped youth directory (AFC-476, US-Y1). Filters and sort flow
 * through the shared collector, which is the same read the CSV export
 * uses -- the two cannot drift. Youth PII is stripped per the role matrix
 * inside the collector; the route returns names, never contact detail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'youth_profiles', 'read')

  const filters = youthFilters(event)
  const { rows, total } = await collectYouth(event, scope, filters)

  // The collector reads the whole filtered set (the export needs it); the
  // list route paginates the window. Same rows, same order.
  const start = (filters.page - 1) * filters.limit
  return {
    data: rows.slice(start, start + filters.limit),
    meta: { total, page: filters.page, limit: filters.limit },
    filters: {
      branch: filters.branch,
      zone: filters.zone,
      education_level: filters.education_level,
      employment_status: filters.employment_status,
      is_entrepreneur: filters.is_entrepreneur,
      status: filters.status,
      sort: youthSortParam(filters.sort),
    },
  }
})
