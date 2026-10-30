import type { VisitorRow } from '../../../types/portal'
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
  'visitor_first_name',
  'visitor_last_name',
  'email',
  'phone',
  'visit_date',
  'event',
  'age_group',
  'invited_by',
  'person',
  'status',
  'follow_up_owner',
  'next_follow_up_date',
  'notes',
  'source',
  'is_cross_branch_visit',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const status = typeof query.status === 'string' ? query.status : 'open'
  // AFC-660: ?event= badge filter was dead server-side (AFC-649 follow-up).
  // Fail-closed: the event predicate joins the _and with scopeFilter below,
  // so an out-of-scope event id matches nothing instead of leaking rows.
  const eventId =
    typeof query.event === 'string' && query.event.trim()
      ? query.event.trim().slice(0, 120)
      : undefined

  const filter =
    status === 'all'
      ? undefined
      : status === 'open'
        ? { status: { _in: ['new', 'follow_up'] } }
        : { status: { _eq: status } }

  // AFC-583: the list read hits the 0025 register. A missing table and a
  // missing read grant both arrive without a deliberate status — map to the
  // named store error, never a bare 500. Deliberate 4xx pass through untouched.
  let result: {
    data: VisitorRow[]
    meta: { total: number; page: number; limit: number }
  }
  try {
    result = await listItems<VisitorRow>(event, scope, 'visitors', {
      filter: mergeFilters(
        filter,
        branch ? { branch: { _eq: branch } } : undefined,
        eventId ? { event: { _eq: eventId } } : undefined,
        scopeFilter(scope),
      ),
      fields: FIELDS,
      sort: 'next_follow_up_date,visit_date',
      page,
      limit,
      search: search || undefined,
    })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: null,
  }))

  return { data: rows, meta: result.meta }
})
