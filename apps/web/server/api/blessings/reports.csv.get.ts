import {
  blessingReportFilters,
  blessingsToCsv,
  collectBlessings,
  collectBlessingsCompare,
} from '../../utils/blessing-report'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Blessings CSV export (US-B2 AC2). Serialises exactly the rows of the
 * shared filtered collection -- the list and the export cannot drift
 * because both read `collectBlessings` with the same filters and the same
 * scope. Columns: branch, zone, service, date, blessing_type, male, female,
 * total. Permission-scoped: a branch export contains only its own branch.
 *
 * US-A4 compare (AFC-485): `compare_prior_year=true` appends the prior-year
 * side (same query, one year back) with a delta line, mirroring the
 * attendance export.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const filters = blessingReportFilters(event)

  // Re-collect without pagination: the list page is a window, the export
  // is the whole filtered aggregate. Same predicate, same order, same
  // scope -- row-equality with the query is structural.
  const { rows, total, breakdown } = await collectBlessings(event, scope, {
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

  const body = blessingsToCsv(rows)
  const compare = await collectBlessingsCompare(event, scope, filters, {
    total,
    breakdown,
  })
  if (compare) {
    const male = breakdown.reduce((sum, line) => sum + line.male, 0)
    const female = breakdown.reduce((sum, line) => sum + line.female, 0)
    body.push(
      [],
      ['section', 'from', 'to', 'male', 'female', 'total'],
      [
        'current',
        filters.date_from ?? '',
        filters.date_to ?? '',
        String(male),
        String(female),
        String(total),
      ],
      [
        'prior',
        compare.from,
        compare.to,
        String(compare.male),
        String(compare.female),
        String(compare.total),
      ],
      ['delta', '', '', '', '', String(compare.delta_total)],
    )
  }

  return csvResponse(event, 'blessings.csv', body)
})
