import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../../../../utils/portal'

const FIELDS = [
  'id',
  'session',
  'activity_type',
  'title',
  'position',
  'duration_minutes',
  'notes',
  'created_by',
  'created_at',
]

/**
 * GET /api/attendance/sessions/:id/activities — programme items for one
 * session, in builder order (position, created_at). The session itself is
 * scope-gated first: a session outside the caller's branch/zone 404s before
 * any item row is read.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'session_activities', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A session id is required' })
  try {
    await findScopedItem(event, scope, 'attendance_sessions', id, { fields: ['id'] })
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'session_activities',
      {
        filter: { session: { _eq: id } },
        fields: FIELDS,
        sort: 'position,created_at',
        limit: 100,
      },
    )
    return { data: result.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0050')
  }
})
