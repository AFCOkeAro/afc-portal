import {
  getPortalScope,
  listItems,
  mergeFilters,
  scopeFilter,
} from '../../utils/portal'
import {
  INVITE_FIELDS,
  INVITE_STATUSES,
  inviteCapabilities,
  isMemberSession,
  projectInviteRow,
  requireInviteCap,
} from '../../utils/event-invites'
import type { InviteRow } from '../../utils/event-invites'

/**
 * List invitations (AFC-480, US-E2 + US-E3 AC1).
 * Member (track d): own invites only, redacted phone + status.
 * Staff: branch scope + filter by event / inviter / status / date; full rows.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'read', 'read event invitations')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const eventFilter = typeof query.event === 'string' ? query.event : undefined
  const inviter = typeof query.inviter === 'string' ? query.inviter : undefined
  const status = typeof query.status === 'string' && INVITE_STATUSES.includes(query.status as never)
    ? query.status
    : undefined
  const from = typeof query.from === 'string' ? query.from : undefined
  const to = typeof query.to === 'string' ? query.to : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined

  const createdRange: Record<string, unknown> = {}
  if (from) createdRange._gte = from
  if (to) createdRange._lte = to

  const result = await listItems<InviteRow>(event, scope, 'event_invites', {
    filter: mergeFilters(
      isMemberSession(scope)
        ? { inviter_user: { _eq: scope.session.user.id } }
        : scopeFilter(scope),
      branch && !isMemberSession(scope) ? { branch: { _eq: branch } } : undefined,
      eventFilter ? { event: { _eq: eventFilter } } : undefined,
      inviter ? { inviter_user: { _eq: inviter } } : undefined,
      status ? { status: { _eq: status } } : undefined,
      Object.keys(createdRange).length > 0 ? { created_at: createdRange } : undefined,
    ),
    fields: INVITE_FIELDS,
    sort: '-created_at',
    page,
    limit,
  })

  return {
    data: result.data.map((row) => projectInviteRow(scope, caps, { ...row, id: String(row.id) })),
    meta: result.meta,
  }
})
