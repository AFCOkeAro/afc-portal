import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'

/**
 * DELETE /api/leave-balances/:id — remove an allowance (0055 grants
 * DELETE; allowance admin is programme content, not an audit fact).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_balances', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A balance id is required' })
  try {
    await findScopedItem(event, scope, 'leave_balances', id, { fields: ['id'] })
    await deleteItem(event, scope, 'leave_balances', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0055')
  }
})
