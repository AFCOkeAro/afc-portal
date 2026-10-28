import {
  deleteItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../utils/portal'

/**
 * DELETE /api/attendance/activities/:id — remove a programme item.
 * Programme draft content (0050 grants DELETE, unlike the attendance and
 * financial registers): removing a wrongly added item is the builder, not
 * an audit event. Scope is enforced through the parent session link.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'session_activities', 'delete')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An activity id is required' })
  try {
    const existing = await findScopedItem<{ id: string; session: string }>(
      event,
      scope,
      'session_activities',
      id,
      { fields: ['id', 'session'] },
    )
    await findScopedItem(event, scope, 'attendance_sessions', String(existing.session), {
      fields: ['id'],
    })
    await deleteItem(event, scope, 'session_activities', id)
    return { data: { deleted: true } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0050')
  }
})
