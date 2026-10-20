import {
  celebrationFeedFilters,
  celebrationsToCsv,
  collectCelebrations,
} from '../../utils/celebration-feed'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Celebrations CSV export (US-Y2 AC2/US-Y3). Serialises exactly the rows of
 * the shared filtered collection -- the list and the export cannot drift
 * because both read `collectCelebrations` with the same filters and the
 * same scope. Columns: branch, zone, person, celebration, date, visibility,
 * status. Permission-scoped; DOB/medical never enter the payload upstream.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const filters = celebrationFeedFilters(event)

  // Re-collect without pagination: the list page is a window, the export
  // is the whole filtered set. Same predicate, same order, same scope --
  // row-equality with the query is structural.
  const { rows } = await collectCelebrations(event, scope, {
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

  return csvResponse(event, 'celebrations.csv', celebrationsToCsv(rows))
})
