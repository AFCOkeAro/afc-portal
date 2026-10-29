import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../../../utils/portal'

/**
 * DELETE /api/events/:id/collaborators/:collaboratorId — remove a
 * collaborator (AFC-880). Gated on events update, same as the add.
 * The row must belong to the event in the path (no cross-event deletes).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'update')

  const id = getRouterParam(event, 'id')
  const collaboratorId = getRouterParam(event, 'collaboratorId')
  if (!id || !collaboratorId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'An event and collaborator id are required',
    })
  }
  try {
    await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
    const row = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_collaborators',
      collaboratorId,
      { fields: ['id', 'event'] },
    )
    if (String(row.event) !== id) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That collaborator is not on this event',
        data: { code: 'not_found' },
      })
    }
    await deleteItem(event, scope, 'event_collaborators', collaboratorId)
    return { data: { id: collaboratorId } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'collaborator_store', '0060')
  }
})
