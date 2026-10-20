import type { VisitorRow } from '../../../types/portal'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
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

  const filter =
    status === 'all'
      ? undefined
      : status === 'open'
        ? { status: { _in: ['new', 'follow_up'] } }
        : { status: { _eq: status } }

  const result = await listItems<VisitorRow>(event, scope, 'visitors', {
    filter: mergeFilters(
      filter,
      branch ? { branch: { _eq: branch } } : undefined,
      scopeFilter(scope),
    ),
    fields: FIELDS,
    sort: 'next_follow_up_date,visit_date',
    page,
    limit,
    search: search || undefined,
  })

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: null,
  }))

  return { data: rows, meta: result.meta }
})
