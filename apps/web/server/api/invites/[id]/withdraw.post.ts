import {
  findScopedItem,
  getPortalScope,
  scopeFilter,
  updateItem,
} from '../../../utils/portal'
import {
  inviteCapabilities,
  isMemberSession,
  requireInviteCap,
} from '../../../utils/event-invites'
import type { InviteRow } from '../../../utils/event-invites'

/**
 * Withdraw an invite (AFC-480, US-E2 AC3: "I can ask staff to stop an
 * invite"). Queued/pending/over-limit rows move to withdrawn; the number is
 * then blocked from further sends for this invite. A member may withdraw
 * their OWN unsent invite; staff may withdraw any in-scope unsent invite.
 */
const WITHDRAWABLE = ['pending_approval', 'queued', 'blocked_rate_limit']

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'read', 'withdraw event invitations')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An invite id is required' })

  const row = await findScopedItem<InviteRow>(event, scope, 'event_invites', id, {
    fields: ['id', 'status', 'inviter_user'],
    scope: isMemberSession(scope)
      ? { inviter_user: { _eq: scope.session.user.id } }
      : scopeFilter(scope),
  })

  if (!WITHDRAWABLE.includes(String(row.status))) {
    throw createError({
      statusCode: 409,
      statusMessage: `Only unsent invites can be withdrawn (this one is ${row.status})`,
      data: { code: 'not_withdrawable', status: row.status },
    })
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'event_invites',
    id,
    {
      status: 'withdrawn',
      blocked_reason:
        'Withdrawn at the inviter/staff request; the number is blocked for this invite',
    },
  )
  return { data: { ...updated, id: String(updated.id) } }
})
