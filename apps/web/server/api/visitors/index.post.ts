import { visitorFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'create')

  const parsed = visitorFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)

  // AFC-583: the create writes the 0025 register — map an unreadable
  // store to the named error, never a bare 500. Deliberate 4xx (validation)
  // pass through; validation runs before the try, so only store failures land here.
  let created: Record<string, unknown>
  try {
    created = await createItem<Record<string, unknown>>(event, scope, 'visitors', {
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
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
  return { data: { ...created, id: String(created.id) } }
})
