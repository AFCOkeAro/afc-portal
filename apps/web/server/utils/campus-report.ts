import type { H3Event } from 'h3'
import { campusProgressScopeFilter, COACHING_PROGRESS_FIELDS } from './campus'
import { listItems, mergeFilters, requireCan, type PortalScope } from './portal'

export interface CampusProgressFilters {
  programme: string | null
  student: string | null
}

/**
 * Shared progress collector (AFC-484, US-C2 AC3). One filtered read feeds
 * the list route and the CSV export, so the two cannot drift. Resolves
 * programme/student display names for the report; score columns are kept
 * (the export is coordinator/branch-admin-own scoped by the programme
 * predicate, matching the §11.1 read rule).
 */
export async function collectCampusProgress(
  event: H3Event,
  scope: PortalScope,
  filters: CampusProgressFilters,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  requireCan(scope, 'coaching_progress', 'read')

  // F1: same intersect as the list route — the CSV cannot drift wider.
  const scopeFilter = await campusProgressScopeFilter(event, scope)
  const filter = mergeFilters(
    scopeFilter,
    filters.programme ? { programme: { _eq: filters.programme } } : undefined,
    filters.student ? { campus_student: { _eq: filters.student } } : undefined,
  )

  const rows: Array<Record<string, unknown>> = []
  let total: number
  let page = 1
  for (;;) {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'coaching_progress',
      {
        filter,
        fields: COACHING_PROGRESS_FIELDS,
        sort: '-progress_date',
        page,
        limit: 200,
      },
    )
    total = result.meta.total
    rows.push(...result.data)
    if (result.data.length < 200 || rows.length >= total) break
    page += 1
  }

  const programmeIds = [
    ...new Set(rows.map((row) => String(row.programme ?? '')).filter(Boolean)),
  ]
  const programmeNames = new Map<string, string>()
  for (let i = 0; i < programmeIds.length; i += 50) {
    const chunk = programmeIds.slice(i, i + 50)
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'coaching_programmes',
      { filter: { id: { _in: chunk } }, fields: ['id', 'name'], limit: 50 },
    )
    for (const row of result.data) {
      if (typeof row.name === 'string') programmeNames.set(String(row.id), row.name)
    }
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      programme_name: programmeNames.get(String(row.programme ?? '')) ?? null,
      student_name: null,
    })),
    total,
  }
}
