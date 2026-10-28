import { leaveBalancePatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'

/**
 * PATCH /api/leave-balances/:id — adjust an allowance. Person and year
 * are write-once (a correction moves the allowance, never the holder).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_balances', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A balance id is required' })
  try {
    await findScopedItem(event, scope, 'leave_balances', id, { fields: ['id'] })
    const parsed = leaveBalancePatchSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'leave_balances',
      id,
      { allowance_days: parsed.data.allowance_days },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0055')
  }
})
