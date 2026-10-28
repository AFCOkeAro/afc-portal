import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../../../utils/portal'

/**
 * DELETE /api/outreach-locations/:id/secretaries?person= — unassign.
 * Removes the assignment row; the location and the person are untouched.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_location_secretaries', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A location id is required' })
  const query = getQuery(event)
  const person = typeof query.person === 'string' ? query.person : ''
  if (!person) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A person id is required',
      data: { code: 'validation_error' },
    })
  }
  try {
    await findScopedItem(event, scope, 'outreach_locations', id, { fields: ['id'] })
    const found = await listItems<{ id: string }>(
      event,
      scope,
      'outreach_location_secretaries',
      {
        filter: { location: { _eq: id }, person: { _eq: person } },
        fields: ['id'],
        limit: 1,
      },
    )
    const linkId = found.data[0]?.id
    if (!linkId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That assignment was not found',
        data: { code: 'not_found' },
      })
    }
    await deleteItem(event, scope, 'outreach_location_secretaries', String(linkId))
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
