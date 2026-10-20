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
    { fields: ['id', 'case_ref', 'status', 'closed_at'] },
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
      event_type: 'status',
      summary: `Status changed to ${status.replace(/_/g, ' ')}`,
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
      amount_requested: form.amount_requested,
      amount_assisted: form.amount_assisted,
      assigned_to: form.assigned_to ?? null,
      description: form.description ?? null,
      outcome_notes: form.outcome_notes ?? null,
      closed_at: form.status === 'closed' ? (existing.closed_at ?? now) : null,
    },
  )

  await createItem(event, scope, 'welfare_case_events', {
    case: id,
    event_type: 'updated',
    summary: `Case ${form.case_ref} updated`,
    actor: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
