import { welfareCaseFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_cases', 'create')

  const body = (await readBody(event)) as Record<string, unknown>
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

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_cases',
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
      opened_at: now,
      closed_at: form.status === 'closed' ? now : null,
    },
  )

  // Audit trail is written by the portal, not by the role: the matrix gives
  // area and branch administrators read-only access to case events.
  await createItem(event, scope, 'welfare_case_events', {
    case: String(created.id),
    event_type: 'created',
    summary: `Case ${form.case_ref} opened`,
    actor: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
