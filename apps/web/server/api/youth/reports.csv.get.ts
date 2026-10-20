import { collectYouth, youthFilters, youthToCsv } from '../../utils/youth-feed'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Youth directory CSV export (US-Y1). Serialises exactly the rows of the
 * shared filtered collection -- the list and the export cannot drift
 * because both read `collectYouth` with the same filters and the same
 * scope. Columns: branch, person, education, employment, entrepreneur,
 * status. Permission-scoped and PII-stripped upstream (the collector
 * applies the FIELD_RESTRICTIONS before the route ever sees the rows).
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const filters = youthFilters(event)

  // Re-collect without pagination: the list page is a window, the export
  // is the whole filtered set. Same predicate, same order, same scope --
  // row-equality with the query is structural.
  const { rows } = await collectYouth(event, scope, { ...filters, page: 1, limit: 200 })

  if (rows.length > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That export is too large for one file. Narrow the filters, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  return csvResponse(event, 'youth.csv', youthToCsv(rows))
})
