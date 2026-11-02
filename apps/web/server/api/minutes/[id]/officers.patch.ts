import { assertUuidParam, createItem, findScopedItem, getPortalScope, listItems, requireCan, scopeFilter, updateItem } from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

const ROLES = ['chairman', 'opening_prayer', 'closing_prayer', 'minutes_read_by', 'minutes_moved_by', 'minutes_seconded_by', 'adjourn_moved_by', 'adjourn_seconded_by']

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')
  await findScopedItem(event, scope, 'office_minutes', id, { fields: ['id'], scope: scopeFilter(scope) })

  const body = await readBody(event)
  const now = new Date().toISOString()

  const patch: Record<string, unknown> = { updated_at: now }
  for (const role of ROLES) {
    if (body && role in body) {
      patch[role] = body[role] === '' ? null : body[role]
    }
  }
  await updateItem(event, scope, 'office_minutes', id, patch)

  // Auto-add officers to attendees (deduplicate)
  const attendees = await listItems<Record<string, unknown>>(event, scope, 'minutes_attendees', {
    filter: { minute: { _eq: id } },
    limit: 500,
  })
  const existing = new Set(
    attendees.data.map((row) => String(row.person ?? row.attendee_user ?? '')).filter(Boolean),
  )

  for (const role of ROLES) {
    const pid = body?.[role]
    if (typeof pid === 'string' && pid.trim() && !existing.has(pid.trim())) {
      try {
        await createItem(event, scope, 'minutes_attendees', {
          minute: id,
          person: pid.trim(),
          created_at: now,
        })
        existing.add(pid.trim())
      } catch {
        // best effort
      }
    }
  }

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'updated',
    detail: 'Meeting officers updated',
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { id } }
})
