import {
  findScopedItem,
  getPortalScope,
  mergeFilters,
  scopeFilter,
} from '../../utils/portal'
import {
  INVITE_FIELDS,
  inviteCapabilities,
  isMemberSession,
  projectInviteRow,
  requireInviteCap,
} from '../../utils/event-invites'
import type { InviteRow } from '../../utils/event-invites'

/**
 * Invite detail (AFC-480, US-E2). Own-or-branch scoped; members get the
 * redacted projection, staff the full row. Technical send detail lives on
 * the delivery log, never here.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'read', 'read event invitations')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An invite id is required' })

  const row = await findScopedItem<InviteRow>(event, scope, 'event_invites', id, {
    fields: INVITE_FIELDS,
    scope: mergeFilters(
      isMemberSession(scope)
        ? { inviter_user: { _eq: scope.session.user.id } }
        : undefined,
      scopeFilter(scope),
    ),
  })

  return { data: projectInviteRow(scope, caps, { ...row, id: String(row.id) }) }
})
