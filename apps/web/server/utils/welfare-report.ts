import type { H3Event } from 'h3'
import type { WelfareReport } from '../../types/portal'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  type PortalScope,
} from './portal'

export interface WelfareReportFilters {
  branch: string | null
  confidentiality: string | null
  status: string | null
  category: string | null
  priority: string | null
}

export function welfareReportFilters(event: H3Event): WelfareReportFilters {
  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  return {
    branch: text('branch'),
    confidentiality: text('confidentiality'),
    status: text('status') ?? 'all',
    category: text('category'),
    priority: text('priority'),
  }
}

/**
 * Welfare reports (AFC-472). Counts by status/category/priority within the
 * caller's scope. The payload carries no restricted fields by construction:
 * groups hold enum values and counts only -- description/outcome_notes are
 * never selected and never serialised, so an unpermitted field cannot leak
 * through the report or its CSV. CSV row-equality is structural: both the
 * JSON route and the CSV route read `collectWelfareAggregate` with the same
 * filters and the same scope.
 */
export async function collectWelfareAggregate(
  event: H3Event,
  scope: PortalScope,
  filters: WelfareReportFilters,
): Promise<WelfareReport> {
  const statusFilter =
    !filters.status || filters.status === 'all'
      ? undefined
      : filters.status === 'open'
        ? { status: { _in: ['open', 'in_progress'] } }
        : { status: { _eq: filters.status } }

  const filter = mergeFilters(
    statusFilter,
    filters.branch ? { branch: { _eq: filters.branch } } : undefined,
    filters.confidentiality
      ? { confidentiality: { _eq: filters.confidentiality } }
      : undefined,
    filters.category ? { category: { _eq: filters.category } } : undefined,
    filters.priority ? { priority: { _eq: filters.priority } } : undefined,
    scopeFilter(scope),
  )

  // Chunked (200 per page) so memory grows with the filtered set, not with
  // an unbounded single page. Welfare volumes are small; the loop still
  // bounds each request the same way the attendance collector does.
  const rows: Array<{
    status: string | null
    category: string | null
    priority: string | null
  }> = []
  let page = 1
  for (;;) {
    const result = await listItems<{
      status: string | null
      category: string | null
      priority: string | null
    }>(event, scope, 'welfare_cases', {
      filter,
      fields: ['status', 'category', 'priority'],
      sort: 'status',
      page,
      limit: 200,
    })
    rows.push(...result.data)
    if (result.data.length < 200 || rows.length >= result.meta.total) break
    page += 1
  }

  const groups = new Map<
    string,
    { status: string; category: string; priority: string; count: number }
  >()
  for (const row of rows) {
    const key = `${row.status ?? 'open'}|${row.category ?? 'other'}|${row.priority ?? 'normal'}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, {
        status: row.status ?? 'open',
        category: row.category ?? 'other',
        priority: row.priority ?? 'normal',
        count: 1,
      })
    }
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      a.status.localeCompare(b.status) ||
      a.category.localeCompare(b.category) ||
      a.priority.localeCompare(b.priority),
  )

  const open = rows.filter(
    (row) => row.status === 'open' || row.status === 'in_progress',
  ).length

  return {
    groups: ordered,
    totals: { cases: rows.length, open },
    filters: {
      branch: filters.branch,
      confidentiality: filters.confidentiality,
      status: filters.status,
      category: filters.category,
      priority: filters.priority,
    },
  }
}

export async function buildWelfareReport(
  event: H3Event,
  scope?: PortalScope,
): Promise<WelfareReport> {
  const resolved = scope ?? (await getPortalScope(event))
  requireCan(resolved, 'welfare_cases', 'read')
  return await collectWelfareAggregate(event, resolved, welfareReportFilters(event))
}
