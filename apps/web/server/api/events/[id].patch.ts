import { eventFormSchema, toEventPayload } from '@afc/shared'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  await findScopedItem(event, scope, 'events', id, {
    fields: ['id'],
    scope: eventScopeFilter(scope),
  })

  const body = (await readBody(event)) as Record<string, unknown>
  if (
    Object.keys(body).length === 1 &&
    ['draft', 'published', 'closed', 'cancelled'].includes(String(body.status))
  ) {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'events',
      id,
      { status: body.status, registration_open: body.status === 'published' },
    )
    return { data: updated }
  }

  const parsed = eventFormSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch, { allowAreaWide: true })
  const updated = await updateItem<Record<string, unknown>>(event, scope, 'events', id, {
    ...toEventPayload({ ...form, branch: branch ?? undefined }),
    registration_open: form.status === 'published',
  })
  return { data: updated }
})
