import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'

/**
 * DELETE /api/leave-requests/:id — withdraw a request. Withdrawing a draft
 * is the tool (0052 grants DELETE); decided rows should be cancelled
 * through PATCH instead, but the route does not invent that refusal.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_requests', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A request id is required' })
  try {
    await findScopedItem(event, scope, 'leave_requests', id, { fields: ['id'] })
    await deleteItem(event, scope, 'leave_requests', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0052')
  }
})
