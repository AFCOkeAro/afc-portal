import { COLLECTIONS, listQuerySchema } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope } from '../../utils/office'

/**
 * GET /api/leave-requests?mine=1&status=&page=&limit=&sort= — scoped leave
 * list (AFC-927 over the AFC-930 register, ADR-0012).
 *
 * Requests tab: `mine=1` narrows to rows the session user requested
 * (mirrors GET /api/tasks `mine`). Approvals tab: the same endpoint with no
 * `mine` filter — the deciding-officer queue — gated by the `update` grant
 * in the UI; the server enforces read scope here and update on PATCH.
 * `requester_name` is resolved route-side (one batch people read; never a
 * raw id in the UI). `requester_photo` is the AFC-864 wire point and is
 * null until person photos land — the UI renders initials until then.
 */
const LEAVE_FIELDS = [
  'id',
  'requester_user',
  'requester_person',
  'leave_type',
  'start_date',
  'end_date',
  'reason',
  'status',
  'decided_by',
  'decided_at',
  'branch',
  'zone',
  'created_at',
  'updated_at',
]

interface PersonName {
  id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
}

function displayName(person: PersonName): string {
  const first = person.preferred_name || person.first_name
  return [first, person.last_name].filter(Boolean).join(' ') || '—'
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, COLLECTIONS.leaveRequests, 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-created_at',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-created_at' }
  const status = typeof query.status === 'string' ? query.status : undefined
  const mine = query.mine === '1'
  logScopedQuery(scope, 'leave-requests.list', {
    status: status ?? 'all',
    mine,
  })

  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    COLLECTIONS.leaveRequests,
    {
      fields: LEAVE_FIELDS,
      filter: {
        ...officeBranchScope(scope),
        ...(status ? { status: { _eq: status } } : {}),
        ...(mine ? { requester_user: { _eq: scope.session.user.id } } : {}),
      },
      page: paging.page,
      limit: paging.limit,
      sort: paging.sort,
    },
  )

  const stripped = stripHiddenMany(scope, COLLECTIONS.leaveRequests, data)

  const personIds = [
    ...new Set(
      stripped
        .map((row) => row.requester_person)
        .filter((value): value is string => typeof value === 'string'),
    ),
  ]
  const names = new Map<string, string>()
  if (personIds.length > 0) {
    const people = await listItems<PersonName>(event, scope, COLLECTIONS.people, {
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      filter: { id: { _in: personIds } },
      limit: personIds.length,
    })
    for (const person of people.data) names.set(person.id, displayName(person))
  }

  const sessionUserId = scope.session.user.id
  const rows = stripped.map((row) => ({
    ...row,
    requester_name:
      typeof row.requester_person === 'string'
        ? (names.get(row.requester_person) ?? null)
        : null,
    // AFC-864 wire point: person photos do not exist yet; the UI falls
    // back to name initials while this stays null.
    requester_photo: null,
    can_edit:
      row.status === 'pending' && row.requester_user === sessionUserId,
  }))
  return { data: rows, meta }
})
