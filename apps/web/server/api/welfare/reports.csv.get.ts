import { buildWelfareReport, collectWelfareAggregate } from '../../utils/welfare-report'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Welfare report CSV (AFC-472). Serialises exactly the grouped counts of
 * the shared filtered aggregate -- the report and the export cannot drift
 * because both read `collectWelfareAggregate` with the same filters and the
 * same scope. The export carries enum values and counts only; restricted
 * fields (description/outcome_notes) are never selected and never in the
 * payload, and no personal data leaves through this route.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const report = await buildWelfareReport(event, scope)

  // Re-collect without pagination: the report page is a window, the export
  // is the whole filtered aggregate. Same predicate, same grouping, same
  // scope -- row-equality with the query is structural.
  const aggregate = await collectWelfareAggregate(event, scope, {
    branch: report.filters.branch,
    confidentiality: report.filters.confidentiality,
    status: report.filters.status,
    category: report.filters.category,
    priority: report.filters.priority,
  })

  if (aggregate.groups.length > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That report is too large for one export. Narrow the filters, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  const rows: string[][] = [
    ['status', 'category', 'priority', 'count'],
    ...aggregate.groups.map((group) => [
      group.status,
      group.category,
      group.priority,
      String(group.count),
    ]),
  ]

  return csvResponse(event, 'welfare-report.csv', rows)
})
