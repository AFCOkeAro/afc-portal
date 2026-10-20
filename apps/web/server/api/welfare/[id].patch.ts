import { welfareCaseFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

const STATUSES = ['open', 'in_progress', 'resolved', 'closed']

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_cases', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A case id is required' })
  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_cases',
    id,
    { fields: ['id', 'case_ref', 'status', 'assigned_to', 'closed_at'] },
  )

  const body = (await readBody(event)) as Record<string, unknown>
  const now = new Date().toISOString()

  if (Object.keys(body).length === 1 && STATUSES.includes(String(body.status))) {
    const status = String(body.status)
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'welfare_cases',
      id,
      {
        status,
        closed_at: status === 'closed' ? now : null,
      },
    )
    await createItem(event, scope, 'welfare_case_events', {
      case: id,
      event_type: 'status_changed',
      detail: `Status changed to ${status.replace(/_/g, ' ')}`,
      summary: `Status changed to ${status.replace(/_/g, ' ')}`,
      actor_user: scope.session.user.id,
      actor: scope.session.user.id,
      created_at: now,
    })
    return { data: updated }
  }

  // Assignment-only change (case detail "assign" action): scoped to the case,
  // audit actor auto-set. Kept distinct from the full-form update below so an
  // assignment never rewrites restricted fields it cannot read.
  if (
    Object.keys(body).length === 1 &&
    Object.prototype.hasOwnProperty.call(body, 'assigned_to')
  ) {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'welfare_cases',
      id,
      { assigned_to: (body.assigned_to as string) || null },
    )
    await createItem(event, scope, 'welfare_case_events', {
      case: id,
      event_type: 'assigned',
      detail: 'Case assigned',
      summary: 'Case assigned',
      actor_user: scope.session.user.id,
      actor: scope.session.user.id,
      created_at: now,
    })
    return { data: updated }
  }

  const parsed = welfareCaseFormSchema.safeParse({
    amount_requested: '',
    amount_assisted: '',
    ...body,
  })
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)
  if (form.person) {
    await findScopedItem(event, scope, 'people', form.person, { fields: ['id'] })
  }

  const assignedChanged =
    (body.assigned_to ?? null) !== (existing.assigned_to ?? null)
  const statusChanged = form.status !== existing.status

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_cases',
    id,
    {
      case_ref: form.case_ref,
      branch: branch ?? null,
      person: form.person ?? null,
      category: form.category,
      priority: form.priority,
      status: form.status,
      confidentiality: form.confidentiality,
      title: form.title ?? null,
      amount_requested: form.amount_requested,
      amount_assisted: form.amount_assisted,
      assigned_to: form.assigned_to ?? null,
      description: form.description ?? null,
      outcome_notes: form.outcome_notes ?? null,
      closed_at: form.status === 'closed' ? (existing.closed_at ?? now) : null,
    },
  )

  // Every mutation leaves its audit row: status changes and assignments get
  // their own event types so the timeline reads as a trail, not a log of
  // "updated".
  const auditType = statusChanged ? 'status_changed' : assignedChanged ? 'assigned' : 'updated'
  const auditSummary =
    auditType === 'status_changed'
      ? `Status changed to ${form.status.replace(/_/g, ' ')}`
      : auditType === 'assigned'
        ? 'Case assigned'
        : `Case ${form.case_ref} updated`
  await createItem(event, scope, 'welfare_case_events', {
    case: id,
    event_type: auditType,
    detail: auditSummary,
    summary: auditSummary,
    actor_user: scope.session.user.id,
    actor: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
