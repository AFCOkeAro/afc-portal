import { eventFormSchema, toEventPayload } from '@afc/shared'
import {
  can,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { areasForEventPatch, requireEventArea } from '../../utils/event-access'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  // Collaborators (AFC-880): a scoped write passes on the role grant, or
  // on every area the body touches. Unknown keys are details. The body is
  // read once here and reused below (the stream reads exactly once).
  const rawBody = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (!can(scope, 'events', 'update')) {
    for (const area of areasForEventPatch(rawBody)) {
      await requireEventArea(event, scope, id, area, {
        collection: 'events',
        action: 'update',
      })
    }
  }
  // AFC-566: every store call below hits the 0021 event register. Map an
  // unreadable store to the named error, never a bare 500; deliberate 4xx
  // (scope 404s, validation) pass through.
  try {
    await findScopedItem(event, scope, 'events', id, {
      fields: ['id'],
      scope: eventScopeFilter(scope),
    })

    const body = rawBody
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
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'events',
      id,
      {
        ...toEventPayload({ ...form, branch: branch ?? undefined }),
        registration_open: form.status === 'published',
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
