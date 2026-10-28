import { workingDaysBetween } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

const FIELDS = [
  'id',
  'person',
  'year',
  'allowance_days',
  'branch',
  'zone',
  'created_by',
  'created_at',
]

/**
 * GET /api/leave-balances — Time Off allowances (AFC-854 phase 1), scoped
 * to the caller's branch/zone. Person names resolve server-side so the
 * page renders one round trip. Used/remaining days arrive in phase 2
 * (computed against leave_requests, unmerged).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_balances', 'read')

  const query = getQuery(event)
  const year = typeof query.year === 'string' ? Number(query.year) : NaN
  const person = typeof query.person === 'string' ? query.person : undefined
  try {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'leave_balances',
      {
        filter: mergeFilters(
          Number.isInteger(year) ? { year: { _eq: year } } : undefined,
          person ? { person: { _eq: person } } : undefined,
          scopeFilter(scope),
        ),
        fields: FIELDS,
        sort: '-year,created_at',
        page: 1,
        limit: 100,
      },
    )
    const personIds = [
      ...new Set(
        result.data.map((row: Record<string, unknown>) => row.person).filter(Boolean),
      ),
    ]
    let names = new Map<string, string>()
    if (personIds.length > 0) {
      const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: 100,
      }).catch(() => ({ data: [] as Record<string, unknown>[] }))
      names = new Map(
        people.data.map((row: Record<string, unknown>) => {
          const full =
            `${String(row.first_name ?? '').trim()} ${String(row.last_name ?? '').trim()}`.trim()
          return [
            String(row.id),
            String(row.preferred_name ?? '').trim() || full || 'Unnamed member',
          ]
        }),
      )
    }
    // Phase 2: used days sum approved leave_requests attributed by the
    // request start year. Best-effort: when the caller cannot read
    // leave_requests, used/remaining stay null instead of failing the
    // whole allowance book.
    let usedByPersonYear = new Map<string, number>()
    let requestsReadable = false
    try {
      const years = [
        ...new Set(
          result.data
            .map((row: Record<string, unknown>) => Number(row.year))
            .filter(Number.isInteger),
        ),
      ]
      if (years.length > 0 && personIds.length > 0) {
        const from = `${Math.min(...years)}-01-01`
        const to = `${Math.max(...years)}-12-31`
        const approved = await listItems<Record<string, unknown>>(
          event,
          scope,
          'leave_requests',
          {
            filter: mergeFilters(
              { person: { _in: personIds } },
              { status: { _eq: 'approved' } },
              { start_date: { _gte: from } },
              { start_date: { _lte: to } },
              scopeFilter(scope),
            ),
            fields: ['person', 'start_date', 'end_date'],
            limit: 500,
          },
        )
        usedByPersonYear = new Map<string, number>()
        requestsReadable = true
        for (const row of approved.data) {
          const days = workingDaysBetween(
            String(row.start_date ?? ''),
            String(row.end_date ?? ''),
          )
          if (days === null) continue
          const key = `${String(row.person)}:${String(row.start_date).slice(0, 4)}`
          usedByPersonYear.set(key, (usedByPersonYear.get(key) ?? 0) + days)
        }
      }
    } catch {
      usedByPersonYear = new Map<string, number>()
      requestsReadable = false
    }
    return {
      data: result.data.map((row: Record<string, unknown>) => {
        const allowance = Number(row.allowance_days ?? 0)
        const key = `${String(row.person)}:${String(row.year)}`
        const used = requestsReadable ? (usedByPersonYear.get(key) ?? 0) : null
        return {
          ...row,
          name: row.person ? (names.get(String(row.person)) ?? 'Unknown') : null,
          used_days: used,
          remaining_days: used === null ? null : allowance - used,
        }
      }),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0055')
  }
})
