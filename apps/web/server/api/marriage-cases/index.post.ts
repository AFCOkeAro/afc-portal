import { MARRIAGE_CASE_TASK_TEMPLATE, marriageCaseFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/**
 * POST /api/marriage-cases — open a pipeline case (AFC-678 phase C).
 *
 * Creates the `marriage_cases` row at `introduction`, writes the `created`
 * trail row, and auto-generates one `tasks` row per flow stage from
 * MARRIAGE_CASE_TASK_TEMPLATE (related_type `marriage_case`). The tasks are
 * the per-couple checklist; completing them never moves the stage -- the
 * transition route owns the gate.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'create')
  requireCan(scope, 'tasks', 'create')

  const parsed = marriageCaseFormSchema.safeParse(await readBody(event))
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

  // Route-side rehearsal lead re-check (DB CHECK is the backstop; the route
  // owns the {code, fields} failure shape).
  if (form.wedding_date && form.rehearsal_date) {
    const lead = Date.parse(form.wedding_date) - Date.parse(form.rehearsal_date)
    if (!Number.isNaN(lead) && lead < 3 * 24 * 60 * 60 * 1000) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The rehearsal must hold at least 3 days before the wedding',
        data: {
          code: 'validation_error',
          fields: { rehearsal_date: 'Keep 3 days before the wedding' },
        },
      })
    }
  }

  const zones = await scopeZoneIds(event, scope)
  const now = new Date().toISOString()
  let created: Record<string, unknown>
  try {
    created = await createItem<Record<string, unknown>>(event, scope, 'marriage_cases', {
      brother_person: form.brother_person,
      sister_person: form.sister_person ?? null,
      branch,
      zone: zones[0] ?? null,
      stage: 'introduction',
      wedding_date: form.wedding_date ?? null,
      rehearsal_date: form.rehearsal_date ?? null,
      engagement_date: form.engagement_date ?? null,
      vow_type: form.vow_type,
      wedding_info_verified: false,
      notes: form.notes ?? null,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  }
  const caseId = String(created.id)

  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: caseId,
    from_stage: null,
    to_stage: 'introduction',
    event_type: 'created',
    detail: 'Case opened at branch introduction',
    actor_user: scope.session.user.id,
    created_at: now,
  })

  // Auto-generated task list: one row per flow stage. Best-effort per row
  // so one bad template row never blocks the case; the detail read reports
  // the generated count.
  let tasksGenerated = 0
  for (const template of MARRIAGE_CASE_TASK_TEMPLATE) {
    const due = new Date(Date.parse(now) + template.dueOffsetDays * 24 * 60 * 60 * 1000)
    try {
      await createItem(event, scope, 'tasks', {
        title: template.title,
        description: `Marriage pipeline: ${template.stageGate}`,
        assignee_user: scope.session.user.id,
        assignee_person: null,
        branch,
        zone: zones[0] ?? null,
        due_date: due.toISOString().slice(0, 10),
        status: 'todo',
        priority: template.priority,
        related_type: 'marriage_case',
        related_id: caseId,
        created_by: scope.session.user.id,
        created_at: now,
        updated_at: now,
      })
      tasksGenerated += 1
    } catch {
      // Logged below via console; the case itself stands.
      console.error(`marriage task generation failed (${template.stageGate})`)
    }
  }

  return { data: { ...created, id: caseId }, meta: { tasksGenerated } }
})
