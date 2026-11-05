import { leaveDecisionSchema, leaveRequestPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'

const TERMINAL: Record<string, readonly string[]> = {
  pending: ['approved', 'declined', 'cancelled'],
  approved: ['cancelled'],
  declined: [],
  cancelled: [],
}

/**
 * PATCH /api/leave-requests/:id — correct a pending request, or record a
 * decision (AFC-842). Draft fields (type, reason) edit only while pending;
 * decisions follow the pending→approved/declined/cancelled and
 * approved→cancelled transitions, stamped with the deciding session user.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_requests', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A request id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'leave_requests',
      id,
      { fields: ['id', 'status'] },
    )
    const current = String(existing.status ?? 'pending')
    const body = await readBody<Record<string, unknown>>(event)

    if (body.status !== undefined) {
      const parsed = leaveDecisionSchema.safeParse(body)
      if (!parsed.success) throwValidation(parsed.error)
      const allowed = TERMINAL[current] ?? []
      if (!allowed.includes(parsed.data.status)) {
        throw createError({
          statusCode: 400,
          statusMessage: `A ${current} request cannot move to ${parsed.data.status}`,
          data: { code: 'invalid_transition' },
        })
      }
      const updated = await updateItem<Record<string, unknown>>(
        event,
        scope,
        'leave_requests',
        id,
        {
          status: parsed.data.status,
          decided_by: scope.session.user.id,
          decided_at: new Date().toISOString(),
        },
      )
      return { data: updated }
    }

    if (current !== 'pending') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Only a pending request can be corrected',
        data: { code: 'invalid_transition' },
      })
    }
    const parsed = leaveRequestPatchSchema.safeParse(body)
    if (!parsed.success) throwValidation(parsed.error)
    if (Object.keys(parsed.data).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nothing to update',
        data: { code: 'validation_error' },
      })
    }
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'leave_requests',
      id,
      {
        ...(parsed.data.leave_type !== undefined
          ? { leave_type: parsed.data.leave_type }
          : {}),
        ...(parsed.data.reason !== undefined
          ? { reason: parsed.data.reason ?? null }
          : {}),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0052')
  }
})
