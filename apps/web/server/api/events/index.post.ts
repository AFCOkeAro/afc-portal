import { eventFormSchema, toEventPayload } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'create')

  const parsed = eventFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch, { allowAreaWide: true })
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'events',
    {
      ...toEventPayload({ ...form, branch: branch ?? undefined }),
      registration_open: form.status === 'published',
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
