import { assertUuidParam, createItem, findScopedItem, getPortalScope, requireCan, scopeFilter } from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')
  await findScopedItem(event, scope, 'office_minutes', id, { fields: ['id'], scope: scopeFilter(scope) })

  const body = await readBody(event)
  const person = typeof body?.person === 'string' ? body.person.trim() : ''
  if (!person) {
    throw createError({ statusCode: 400, statusMessage: 'Person is required', data: { code: 'validation_error', fields: { person: 'Select a person' } } })
  }

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(event, scope, 'minutes_attendees', {
    minute: id,
    person,
    created_at: now,
  })

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'updated',
    detail: `Attendee added`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: created }
})
