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
  // AFC-826: the Schedule tab lists one event's sessions.
  const eventId = typeof query.event === 'string' ? query.event : undefined

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
        eventId ? { event: { _eq: eventId } } : undefined,
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

  // AFC-859: split-aggregate display totals. One batched attendance_counts
  // read (session _in listed ids, fields session/count), summed per session.
  // Best-effort on purpose: roles without attendance_counts read (e.g.
  // volunteer CU) keep the stored headcount_total view instead of losing the
  // whole sessions list, so a denial here degrades to split_total null
  // rather than failing the request. No new endpoint, no DDL.
  const splitTotals = new Map<string, number>()
  {
    const ids = result.data.map((row) => String(row.id))
    if (ids.length > 0) {
      try {
        const splits = await listItems<{ session: unknown; count: unknown }>(
          event,
          scope,
          'attendance_counts',
          {
            filter: { session: { _in: ids } },
            fields: ['session', 'count'],
            limit: -1,
          },
        )
        for (const split of splits.data) {
          const key = String(split.session)
          const amount = Number(split.count)
          splitTotals.set(
            key,
            (splitTotals.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0),
          )
        }
      } catch {
        // Deliberate degradation: split_total stays null below.
      }
    }
  }

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    records_count: counts.get(String(row.id)) ?? 0,
    split_total: splitTotals.get(String(row.id)) ?? null,
  }))

  return { data: rows, meta: result.meta }
})
