import {
  blessingReportFilters,
  blessingsToCsv,
  collectBlessings,
} from '../../utils/blessing-report'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Blessings CSV export (US-B2 AC2). Serialises exactly the rows of the
 * shared filtered collection -- the list and the export cannot drift
 * because both read `collectBlessings` with the same filters and the same
 * scope. Columns: branch, zone, service, date, blessing_type, male, female,
 * total. Permission-scoped: a branch export contains only its own branch.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const filters = blessingReportFilters(event)

  // Re-collect without pagination: the list page is a window, the export
  // is the whole filtered aggregate. Same predicate, same order, same
  // scope -- row-equality with the query is structural.
  const { rows } = await collectBlessings(event, scope, {
    ...filters,
    page: 1,
    limit: 200,
  })

  if (rows.length > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That export is too large for one file. Narrow the filters, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  return csvResponse(event, 'blessings.csv', blessingsToCsv(rows))
})
