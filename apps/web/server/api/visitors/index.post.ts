import { visitorFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'create')

  const parsed = visitorFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)

  const created = await createItem<Record<string, unknown>>(event, scope, 'visitors', {
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
  })
  return { data: { ...created, id: String(created.id) } }
})
