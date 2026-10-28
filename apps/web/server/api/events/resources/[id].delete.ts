import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../utils/portal'

/**
 * DELETE /api/events/resources/:id — remove a resource (0054 grants
 * DELETE; the library is programme admin content, not an audit fact).
 * Uploaded files outlive the catalogue row in directus_files.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_resources', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A resource id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_resources',
      id,
      { fields: ['id', 'event'] },
    )
    await findScopedItem(event, scope, 'events', String(existing.event), {
      fields: ['id'],
    })
    await deleteItem(event, scope, 'event_resources', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'resource_store', '0054')
  }
})
