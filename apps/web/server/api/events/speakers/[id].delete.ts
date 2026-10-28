import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../utils/portal'

/**
 * DELETE /api/events/speakers/:id — withdraw a booking (0053 grants
 * DELETE; bookings are programme admin content, not audit facts).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_speakers', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A booking id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_speakers',
      id,
      { fields: ['id', 'event'] },
    )
    await findScopedItem(event, scope, 'events', String(existing.event), {
      fields: ['id'],
    })
    await deleteItem(event, scope, 'event_speakers', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'speaker_store', '0053')
  }
})
