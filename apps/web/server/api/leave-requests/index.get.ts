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
  'branch',
  'zone',
  'person',
  'start_date',
  'end_date',
  'days',
  'leave_type',
  'reason',
  'status',
  'decided_by',
  'decided_at',
  'created_by',
  'created_at',
]

/**
 * GET /api/leave-requests — Church Office leave list (AFC-842), scoped to
 * the caller's branch/zone. Branch + status filters feed the page.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_requests', 'read')

  const query = getQuery(event)
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const status = typeof query.status === 'string' ? query.status : undefined
  const person = typeof query.person === 'string' ? query.person : undefined
  try {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'leave_requests',
      {
        filter: mergeFilters(
          branch ? { branch: { _eq: branch } } : undefined,
          status ? { status: { _eq: status } } : undefined,
          person ? { person: { _eq: person } } : undefined,
          scopeFilter(scope),
        ),
        fields: FIELDS,
        sort: '-start_date,-created_at',
        page: 1,
        limit: 100,
      },
    )
    return { data: result.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0052')
  }
})
