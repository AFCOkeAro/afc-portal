import {
  buildAttendanceReport,
  collectSplitAggregate,
} from '../../utils/attendance-report'
import { csvResponse, getPortalScope } from '../../utils/portal'

/**
 * Split-contract CSV (AFC-468 US-A3 AC3–AC4). Serialises exactly the grouped
 * rows of the shared filtered aggregate — the report and the export cannot
 * drift because both read `collectSplitAggregate` — with the contract
 * columns branch, zone, service, date, category, male, female, total.
 *
 * Reads are chunked (200 sessions per page inside the collector), so memory
 * grows with the grouped cardinality, not with the raw row count. Past that,
 * ranges stay bounded by an explicit ceiling: beyond MAX_EXPORT_ROWS grouped
 * rows the route refuses with `range_too_large` and names the narrowing fix
 * (shorter range, one service type) instead of buffering unboundedly. That
 * refusal is the documented async fallback contract: a client that needs the
 * whole range re-requests it bucketed by period and concatenates.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  const report = await buildAttendanceReport(event, scope)

  // Re-collect without pagination: the report page is a window, the export
  // is the whole filtered aggregate. Same predicate, same grouping, same
  // scope — row-equality with the query is structural.
  const aggregate = await collectSplitAggregate(event, scope, {
    groupBy: report.filters.group_by,
    sessionType: report.filters.session_type ?? undefined,
    branch: report.filters.branch,
    zone: report.filters.zone,
    from: report.filters.from,
    to: report.filters.to,
    period: report.filters.period,
  })

  if (aggregate.rows.length > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That range is too large for one export. Narrow the dates or pick one service type, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  const rows: string[][] = [
    ['branch', 'zone', 'service', 'date', 'category', 'male', 'female', 'total'],
    ...aggregate.rows.map((row) => [
      row.branch_name ?? '',
      row.zone_name ?? '',
      row.service,
      row.date,
      row.category,
      String(row.male),
      String(row.female),
      String(row.total),
    ]),
  ]

  // Compare views stream the same query (AFC-485, US-A4): when the report was
  // asked for the prior-year side, the export carries it as a second section
  // with a delta line, so the file and the toggled page cannot disagree.
  const rawCompare = getQuery(event).compare_prior_year
  const wantsCompare = rawCompare === true || rawCompare === 'true' || rawCompare === '1'
  if (wantsCompare && report.compare) {
    const prior = await collectSplitAggregate(event, scope, {
      groupBy: report.filters.group_by,
      sessionType: report.filters.session_type ?? undefined,
      branch: report.filters.branch,
      zone: report.filters.zone,
      from: report.compare.from,
      to: report.compare.to,
      period: report.filters.period,
    })
    const currentTotal = aggregate.rows.reduce((sum, row) => sum + row.total, 0)
    const priorTotal = prior.rows.reduce((sum, row) => sum + row.total, 0)
    rows.push(
      [],
      ['section', 'from', 'to', 'sessions', 'total'],
      ['current', report.filters.from, report.filters.to, String(aggregate.sessions), String(currentTotal)],
      ['prior', report.compare.from, report.compare.to, String(prior.sessions), String(priorTotal)],
      ['delta', '', '', '', String(currentTotal - priorTotal)],
    )
  }

  return csvResponse(
    event,
    `attendance-report-${report.filters.from}-to-${report.filters.to}.csv`,
    rows,
  )
})
