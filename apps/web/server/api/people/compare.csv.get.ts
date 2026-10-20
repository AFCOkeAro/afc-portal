import { collectPeopleCompare, parsePeopleCompareQuery } from '../../utils/people-compare'
import { csvResponse, getPortalScope, requireCan } from '../../utils/portal'

/**
 * People compare CSV (AFC-485, US-A4). Streams the same grouped query the
 * compare view returns (current vs prior-year snapshot with delta), same
 * scope, same grouping — the file and the page cannot drift because both
 * read `collectPeopleCompare`.
 */
export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')

  const { groupBy, dataYear } = parsePeopleCompareQuery(event)
  const { rows } = await collectPeopleCompare(event, scope, groupBy, dataYear)
  return csvResponse(event, `people-compare-${dataYear}.csv`, [
    ['group', 'current', 'prior', 'delta'],
    ...rows.map((row) => [
      row.group_name ?? row.group,
      String(row.current),
      String(row.prior),
      String(row.delta),
    ]),
  ])
})
