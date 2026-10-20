import {
  blessingReportFilters,
  blessingSortParam,
  collectBlessings,
  collectBlessingsCompare,
} from '../../utils/blessing-report'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/blessings?branch=&zone=&blessing_type=&period=monthly
 *   &date_from=&date_to=&session=&event=&sunday_service=&bsc=
 *   &group_by=branch&sort=-service_date&page=&limit=&compare_prior_year=true
 *
 * Hierarchy-scoped blessings list (AFC-474, data-model-expansion §10).
 * Filters, bucket periods (week/month/quarter/year/custom) and sort all
 * flow through the shared collector, which is the same read the CSV export
 * and the profile roll-ups use -- the three cannot drift.
 *
 * US-A4 compare (AFC-485): `compare_prior_year=true` adds the prior-year
 * side (same predicate, one year back) with a delta, mirroring the
 * attendance report toggle.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessings', 'read')

  const filters = blessingReportFilters(event)
  const { rows, total, breakdown } = await collectBlessings(event, scope, filters)
  const compare = await collectBlessingsCompare(event, scope, filters, { total, breakdown })

  // The collector reads the whole filtered set (the export and roll-ups need
  // it); the list route paginates the window. Same rows, same order.
  const start = (filters.page - 1) * filters.limit
  return {
    data: rows.slice(start, start + filters.limit),
    meta: { total, page: filters.page, limit: filters.limit },
    breakdown,
    compare,
    filters: {
      branch: filters.branch,
      zone: filters.zone,
      blessing_type: filters.blessing_type,
      period: filters.period,
      date_from: filters.date_from,
      date_to: filters.date_to,
      sort: blessingSortParam(filters.sort),
    },
  }
})
