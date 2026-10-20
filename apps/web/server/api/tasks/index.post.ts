import { taskFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/** POST /api/tasks — create a task with assignee, due date, status (US-E3 AC1). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'create')

  const parsed = taskFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }
  const zones = await scopeZoneIds(event, scope)
  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(event, scope, 'tasks', {
    title: form.title,
    description: form.description ?? null,
    assignee_user: form.assignee_user ?? null,
    assignee_person: form.assignee_person ?? null,
    branch,
    zone: zones[0] ?? null,
    due_date: form.due_date ?? null,
    status: 'todo',
    priority: form.priority,
    related_type: form.related_type ?? null,
    related_id: form.related_id ?? null,
    created_by: scope.session.user.id,
    created_at: now,
    updated_at: now,
  })

  await writeOfficeAudit(event, scope, 'task_events', {
    task: String(created.id),
    event_type: 'created',
    detail: `Task created: ${form.title}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
