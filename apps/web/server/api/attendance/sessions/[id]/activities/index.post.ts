import { sessionActivityFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
} from '../../../../../utils/portal'

/**
 * POST /api/attendance/sessions/:id/activities — append a programme item.
 * Branch/zone stamp from the parent session (0044 choice-8: the route owns
 * scope, no trigger backstop on this register). The session is scope-gated:
 * items cannot be hung on a session outside the caller's scope.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'session_activities', 'create')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A session id is required' })
  try {
    const session = await findScopedItem<{
      id: string
      branch: string | null
      zone: string | null
    }>(event, scope, 'attendance_sessions', id, { fields: ['id', 'branch', 'zone'] })

    const parsed = sessionActivityFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'session_activities',
      {
        session: id,
        branch: session.branch ?? null,
        zone: session.zone ?? null,
        activity_type: form.activity_type,
        title: form.title,
        position: form.position,
        duration_minutes: form.duration_minutes ?? null,
        notes: form.notes ?? null,
        created_by: scope.session.user.id,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0050')
  }
})
