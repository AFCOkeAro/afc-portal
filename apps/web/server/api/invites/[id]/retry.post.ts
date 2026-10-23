import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  scopeFilter,
} from '../../../utils/portal'
import { inviteCapabilities, requireInviteCap } from '../../../utils/event-invites'
import type { InviteRow } from '../../../utils/event-invites'

/**
 * Retry a failed send once, idempotently (AFC-480, US-E3 AC2). Only rows in
 * failed may be retried, and only when no retry row already points at them
 * (retry_of): the second attempt is a NEW row, never an edit of the frozen
 * original. A repeat call returns the existing retry (200, retried:false)
 * instead of creating a duplicate.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'retry', 'retry event invitations')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An invite id is required' })

  const row = await findScopedItem<InviteRow>(event, scope, 'event_invites', id, {
    scope: scopeFilter(scope),
  })

  if (row.status !== 'failed') {
    throw createError({
      statusCode: 409,
      statusMessage: `Only failed invites can be retried (this one is ${row.status})`,
      data: { code: 'not_retryable', status: row.status },
    })
  }

  const existing = await listItems<InviteRow>(event, scope, 'event_invites', {
    filter: { retry_of: { _eq: id } },
    fields: ['id', 'status', 'created_at'],
    limit: 1,
  })
  const prior = existing.data[0]
  if (prior) {
    return {
      data: { ...prior, id: String(prior.id) },
      meta: { retried: false, reason: 'a retry already exists for this invite' },
    }
  }

  const {
    id: _dropped,
    status: _status,
    communication: _comm,
    recipient: _recip,
    approved_by: _ab,
    approved_at: _aa,
    blocked_reason: _br,
    created_at: _ca,
    ...copyable
  } = row
  void _dropped
  void _status
  void _comm
  void _recip
  void _ab
  void _aa
  void _br
  void _ca

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'event_invites',
    {
      ...copyable,
      communication: null,
      recipient: null,
      status: 'queued',
      approval_required: false,
      approved_by: null,
      approved_at: null,
      blocked_reason: null,
      retry_of: id,
    },
  )
  return { data: { ...created, id: String(created.id) }, meta: { retried: true } }
})
