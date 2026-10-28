import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'

/**
 * DELETE /api/outreach-locations/:id — remove a mission field.
 * Assignments cascade (0051); programme admin content, not an audit fact.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_locations', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A location id is required' })
  try {
    await findScopedItem(event, scope, 'outreach_locations', id, { fields: ['id'] })
    await deleteItem(event, scope, 'outreach_locations', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
