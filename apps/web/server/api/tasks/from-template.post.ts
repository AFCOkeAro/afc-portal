import { expandTaskTemplate, getTaskTemplate, taskFromTemplateSchema } from '@afc/shared'
import {
  createItem,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeFilter,
  scopeZoneIds,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'
import { officeZoneScope, writeOfficeAudit } from '../../utils/office'

/**
 * POST /api/tasks/from-template — apply a recurring checklist template
 * (AFC-668): marriage process, event programme, … Each step becomes an
 * ordinary task row with its due date offset from the base date, linked via
 * related_type/related_id when supplied. No schema change: templates live
 * in code (@afc/shared task-templates) and every row goes through the same
 * creation path, permission and audit trail as a manual task.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'create')

  const parsed = taskFromTemplateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const template = getTaskTemplate(form.template)
  if (!template) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown template',
      data: { code: 'validation_error', fields: { template: 'Unknown template' } },
    })
  }

  // AFC-832: a template only attaches inside its own domain. A marriage
  // template linked to an event (or vice versa) fails closed here instead
  // of scattering mislabelled tasks. Unlinked applies (no related_id)
  // behave as before.
  if (form.related_id) {
    if (template.relatedType === 'event') {
      await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'events',
        form.related_id,
        {
          fields: ['id', 'branch'],
          scope: eventScopeFilter(scope),
        },
      ).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error
        throwStoreUnavailable(error, 'event store', '0021')
      })
    } else if (template.relatedType === 'marriage') {
      await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'marriage_cases',
        form.related_id,
        { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
      ).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error
        throwStoreUnavailable(error, 'marriage store', '0035')
      })
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: 'That template cannot attach to a record',
        data: {
          code: 'template_domain_unknown',
          fields: { template: 'Pick a supported template' },
        },
      })
    }
  }

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
  const steps = expandTaskTemplate(template, form.base_date ?? null)
  const ids: string[] = []
  for (const step of steps) {
    const created = await createItem<Record<string, unknown>>(event, scope, 'tasks', {
      title: step.title,
      description: `From template: ${template.label}`,
      assignee_user: form.assignee_user ?? scope.session.user.id,
      assignee_person: form.assignee_person ?? null,
      branch,
      zone: zones[0] ?? null,
      due_date: step.due_date,
      status: 'todo',
      priority: step.priority,
      related_type: template.relatedType,
      related_id: form.related_id ?? null,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    })
    ids.push(String(created.id))
  }

  await writeOfficeAudit(event, scope, 'task_events', {
    task: ids[0] ?? null,
    event_type: 'template_applied',
    detail: `Template applied: ${template.label} (${ids.length} tasks)`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { created: ids.length, ids } }
})
