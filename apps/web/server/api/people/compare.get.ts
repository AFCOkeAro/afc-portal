import { collectPeopleCompare, parsePeopleCompareQuery } from '../../utils/people-compare'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * People compare (AFC-485, US-A4).
 *
 * GET /api/people/compare?group_by=branch|zone&data_year=YYYY — current
 * headcounts grouped by branch|zone (same grouping as the directory) beside
 * the prior-year imported snapshot for `data_year` with a delta.
 *
 * The prior-year side reads the `prior_year_import_items` ledger for the
 * people domain (`source = 'import'`, that `data_year`), grouped by the
 * branch recorded at import time — the people analogue of shifting the
 * attendance predicate one year back. People rows have no service date to
 * shift; the import batch IS the snapshot. Until migration 0014 lands the
 * ledger read tolerates a missing table and reports `has_data: false`
 * instead of failing the current counts.
 *
 * Permission-scoped like the directory: branch staff see only their own
 * branches' groups. No PII crosses this endpoint — groups carry branch ids,
 * names, and counts only.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')

  const { groupBy, dataYear } = parsePeopleCompareQuery(event)
  const { rows, current, prior, has_data } = await collectPeopleCompare(
    event,
    scope,
    groupBy,
    dataYear,
  )
  return {
    data: {
      group_by: groupBy,
      data_year: dataYear,
      rows,
      totals: { current, prior },
      has_data,
    },
  }
})
