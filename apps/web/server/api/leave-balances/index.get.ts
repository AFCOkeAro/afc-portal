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
    return {
      data: result.data.map((row: Record<string, unknown>) => ({
        ...row,
        name: row.person ? (names.get(String(row.person)) ?? 'Unknown') : null,
      })),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0055')
  }
})
