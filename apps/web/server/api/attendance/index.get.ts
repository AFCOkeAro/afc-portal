import type { AttendanceSessionRow } from '../../../types/portal'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

const FIELDS = [
  'id',
  'branch',
  'session_date',
  'session_type',
  'service',
  'event',
  'session_name',
  'headcount_total',
  'headcount_men',
  'headcount_women',
  'headcount_children',
  'recorded_by',
  'recorded_at',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_sessions', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const sessionType =
    typeof query.session_type === 'string' ? query.session_type : undefined

  // AFC-566: both reads hit 0023 registers. A missing table and a
  // missing read grant both arrive as DirectusAuthError — map to the named
  // store error, never a bare 500. Deliberate 4xx pass through untouched.
  let result: {
    data: AttendanceSessionRow[]
    meta: { total: number; page: number; limit: number }
  }
  const counts = new Map<string, number>()
  try {
    result = await listItems<AttendanceSessionRow>(event, scope, 'attendance_sessions', {
      filter: mergeFilters(
        branch ? { branch: { _eq: branch } } : undefined,
        sessionType ? { session_type: { _eq: sessionType } } : undefined,
        scopeFilter(scope),
      ),
      fields: FIELDS,
      sort: '-session_date,-id',
      page,
      limit,
      search: search || undefined,
    })

    const ids = result.data.map((row) => String(row.id))
    if (ids.length > 0) {
      const records = await listItems<{ session: string }>(
        event,
        scope,
        'attendance_records',
        {
          filter: { session: { _in: ids } },
          fields: ['session'],
          limit: -1,
        },
      )
      for (const record of records.data) {
        const key = String(record.session)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0023')
  }

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    records_count: counts.get(String(row.id)) ?? 0,
  }))

  return { data: rows, meta: result.meta }
})
