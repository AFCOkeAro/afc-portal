import {
  COLLECTIONS,
  leaveDecisionSchema,
  leaveEditSchema,
} from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope, writeOfficeAudit } from '../../utils/office'

/**
 * PATCH /api/leave-requests/:id (AFC-927 over the AFC-930 register,
 * ADR-0012 Dec.2 — edits are route rules, not CHECKs).
 *
 * Two mutually exclusive paths, chosen by the body:
 *
 * - Requester edit `{ leave_type?, start_date?, end_date?, reason? }`:
 *   the row must be `pending` and `requester_user` must be the session
 *   user. Dates are merged with the stored row before the order check so
 *   a single-date edit still validates end >= start.
 * - Deciding-officer decision `{ status: approved | rejected }`: requires
 *   the `update` grant (zonal/area deciding officers), pending-only, and
 *   stamps `decided_by`/`decided_at` from the session. A CHECK cannot know
 *   the actor, so the stamp lives here.
 *
 * Both paths write the explicit audit row (`updated` / `status_changed`).
 * No status-escalation widening: nothing here moves a decided row.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, COLLECTIONS.leaveRequests, 'read')

  const body = (await readBody(event)) as Record<string, unknown>
  const isDecision = body.status !== undefined

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    COLLECTIONS.leaveRequests,
    id,
    { scope: officeBranchScope(scope) },
  )
  logScopedQuery(scope, 'leave-requests.patch', {
    id,
    kind: isDecision ? 'decision' : 'edit',
  })

  if (row.status !== 'pending') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Only a pending request can be changed',
      data: { code: 'not_pending' },
    })
  }

  const now = new Date().toISOString()

  if (isDecision) {
    requireCan(scope, COLLECTIONS.leaveRequests, 'update')
    const parsed = leaveDecisionSchema.safeParse(body)
    if (!parsed.success) throwValidation(parsed.error)

    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      COLLECTIONS.leaveRequests,
      id,
      {
        status: parsed.data.status,
        decided_by: scope.session.user.id,
        decided_at: now,
      },
    )
    await writeOfficeAudit(event, scope, COLLECTIONS.leaveRequestEvents, {
      leave_request: id,
      event_type: 'status_changed',
      detail: `Status → ${parsed.data.status}`,
      actor_user: scope.session.user.id,
      created_at: now,
    })
    return { data: updated }
  }

  if (row.requester_user !== scope.session.user.id) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the requester can edit a pending request',
      data: { code: 'not_requester' },
    })
  }
  const parsed = leaveEditSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  if (Object.keys(parsed.data).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nothing to update',
      data: { code: 'empty_patch' },
    })
  }

  const start = (parsed.data.start_date ?? row.start_date) as string
  const end = (parsed.data.end_date ?? row.end_date) as string
  if (start > end) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The end date must be on or after the start date',
      data: { code: 'invalid_dates', fields: { end_date: 'End date is before start date' } },
    })
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    COLLECTIONS.leaveRequests,
    id,
    { ...parsed.data },
  )
  await writeOfficeAudit(event, scope, COLLECTIONS.leaveRequestEvents, {
    leave_request: id,
    event_type: 'updated',
    detail: `Edited ${Object.keys(parsed.data).join(', ')}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })
  return { data: updated }
})
