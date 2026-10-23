import {
  findScopedItem,
  getPortalScope,
  scopeFilter,
  updateItem,
} from '../../../utils/portal'
import { inviteCapabilities, requireInviteCap } from '../../../utils/event-invites'
import type { InviteRow } from '../../../utils/event-invites'

/**
 * Approve an invite (AFC-480, US-E1 AC4 + US-E3 AC4). Branch admin and
 * above only. Approvable states: pending_approval (event-level) and
 * blocked_rate_limit (over-limit). Approval moves the row to queued for the
 * send path; it never touches delivery state itself.
 * blocked_optout rows have NO approval path: staff cannot override an
 * opt-out (data-model-v4 §5 explicit denials), so they 403 here.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'approve', 'approve event invitations')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An invite id is required' })

  const row = await findScopedItem<InviteRow>(event, scope, 'event_invites', id, {
    fields: ['id', 'status', 'approval_required', 'branch', 'inviter_user'],
    scope: scopeFilter(scope),
  })

  if (row.status === 'blocked_optout') {
    throw createError({
      statusCode: 403,
      statusMessage:
        'Opt-outs are permanent; staff cannot re-approve a suppressed number',
      data: { code: 'optout_not_overridable' },
    })
  }
  if (row.status !== 'pending_approval' && row.status !== 'blocked_rate_limit') {
    throw createError({
      statusCode: 409,
      statusMessage: `Only pending or over-limit invites can be approved (this one is ${row.status})`,
      data: { code: 'not_approvable', status: row.status },
    })
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'event_invites',
    id,
    {
      status: 'queued',
      approval_required: false,
      approved_by: scope.session.user.id,
      approved_at: new Date().toISOString(),
      blocked_reason: null,
    },
  )

  return { data: { ...updated, id: String(updated.id) } }
})
