import { visitorFormSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A visitor id is required' })
  await findScopedItem(event, scope, 'visitors', id, { fields: ['id'] })

  const body = (await readBody(event)) as Record<string, unknown>
  const statuses = ['new', 'follow_up', 'converted', 'closed', 'declined']
  if (Object.keys(body).length === 1 && statuses.includes(String(body.status))) {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'visitors',
      id,
      { status: body.status, last_contact_at: new Date().toISOString() },
    )
    return { data: updated }
  }

  const parsed = visitorFormSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'visitors',
    id,
    {
      branch: branch ?? null,
      visitor_first_name: form.visitor_first_name,
      visitor_last_name: form.visitor_last_name,
      email: form.email ?? null,
      phone: form.phone ?? null,
      visit_date: form.visit_date,
      event: form.event ?? null,
      age_group: form.age_group,
      invited_by: form.invited_by ?? null,
      follow_up_owner: form.follow_up_owner ?? null,
      next_follow_up_date: form.next_follow_up_date ?? null,
      notes: form.notes ?? null,
      status: form.status,
    },
  )
  return { data: updated }
})
