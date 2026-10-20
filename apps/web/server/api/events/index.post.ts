import { eventFormSchema, toEventPayload } from '@afc/shared'
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
  requireCan(scope, 'events', 'create')

  const parsed = eventFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // AFC-566: the create hits the 0021 event register. A missing table
  // surfaces as DirectusAuthError — map it to the named store error, never
  // a bare 500. Deliberate 4xx (validation) passes through untouched.
  const branch = resolveBranch(scope, form.branch, { allowAreaWide: true })
  try {
    const created = await createItem<Record<string, unknown>>(event, scope, 'events', {
      ...toEventPayload({ ...form, branch: branch ?? undefined }),
      registration_open: form.status === 'published',
    })

    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
