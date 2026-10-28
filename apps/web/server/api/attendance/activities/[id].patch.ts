import { sessionActivityPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

/**
 * PATCH /api/attendance/activities/:id — retitle, retype, reorder or
 * re-time a programme item. Session/branch/zone are write-once (stamped at
 * create from the parent session); scope is enforced through the parent
 * session link.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'session_activities', 'update')

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

    const parsed = sessionActivityPatchSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data
    if (Object.keys(form).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nothing to update',
        data: { code: 'validation_error' },
      })
    }

    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'session_activities',
      id,
      {
        ...(form.activity_type !== undefined
          ? { activity_type: form.activity_type }
          : {}),
        ...(form.title !== undefined ? { title: form.title } : {}),
        ...(form.position !== undefined ? { position: form.position } : {}),
        ...(form.duration_minutes !== undefined
          ? { duration_minutes: form.duration_minutes ?? null }
          : {}),
        ...(form.notes !== undefined ? { notes: form.notes ?? null } : {}),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0050')
  }
})
