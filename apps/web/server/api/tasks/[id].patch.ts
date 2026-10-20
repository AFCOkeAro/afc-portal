import { taskStatusSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/** PATCH /api/tasks/:id { status } — lifecycle move with audit (US-E3 AC1). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'update')

  const parsed = taskStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const id = String(getRouterParam(event, 'id'))
  await findScopedItem(event, scope, 'tasks', id, { scope: scopeFilter(scope) })

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(event, scope, 'tasks', id, {
    status: parsed.data.status,
    updated_at: now,
  })

  await writeOfficeAudit(event, scope, 'task_events', {
    task: id,
    event_type: 'status_changed',
    detail: `Status → ${parsed.data.status}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
