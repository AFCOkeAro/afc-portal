import { resolveCheckIn } from '../../../utils/event-registration-completion'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  updateItem,
} from '../../../utils/portal'
import { requireEventArea } from '../../../utils/event-access'

const CHECKIN_FIELDS = [
  'id',
  'event',
  'registrant_first_name',
  'registrant_last_name',
  'ticket_code',
  'registration_status',
]

/**
 * Staff check-in by ticket code or name (AFC-470 §2).
 *
 * Needs the `event_registrations` update grant, which volunteers hold on
 * check-in fields — so ushers can check in without the read grant. The
 * route therefore never returns a list: an exact ticket resolves to one
 * row; a name must narrow to exactly one live row or the route answers
 * 409 with the match count and asks staff to refine, rather than leaking
 * a roster (these rows include minors) or checking in the wrong person.
 * Checking in an already-attended row is idempotent, not an error.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  await requireEventArea(event, scope, id, 'registration', {
    collection: 'event_registrations',
    action: 'update',
  })
  // AFC-566: scope-gate + roster read below hit 0021 registers.
  // Unreadable store → named error, never a bare 500; the deliberate
  // check-in 400/404/409s below pass through untouched.
  try {
    await findScopedItem(event, scope, 'events', id, {
      fields: ['id'],
      scope: eventScopeFilter(scope),
    })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const hasTicket = String(body.ticket_code ?? '').trim() !== ''
  const hasName = String(body.name ?? '').trim() !== ''
  if (hasTicket === hasName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Send exactly one of ticket_code or name',
      data: { code: 'checkin_needs_one_query' },
    })
  }

  let result: { data: Record<string, unknown>[] }
  try {
    result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'event_registrations',
      {
        filter: { event: { _eq: id } },
        fields: CHECKIN_FIELDS,
        limit: -1,
      },
    )
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
  const resolution = resolveCheckIn(result.data, {
    ticket_code: body.ticket_code,
    name: body.name,
  })
  if (resolution.kind === 'not_found') {
    throw createError({
      statusCode: 404,
      statusMessage: 'No registration matches that ticket or name for this event',
      data: { code: 'checkin_not_found' },
    })
  }
  if (resolution.kind === 'ambiguous') {
    throw createError({
      statusCode: 409,
      statusMessage: `${resolution.count} registrations match that name — ask for the ticket code or the full name`,
      data: { code: 'checkin_ambiguous', count: resolution.count },
    })
  }

  const row = resolution.row as Record<string, unknown>
  if (row.registration_status === 'attended') {
    return { data: { ...row, id: String(row.id) }, meta: { already: true } }
  }
  if (row.registration_status === 'cancelled') {
    throw createError({
      statusCode: 409,
      statusMessage:
        'That registration was cancelled — re-register instead of checking in',
      data: { code: 'checkin_cancelled' },
    })
  }
  try {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'event_registrations',
      String(row.id),
      { registration_status: 'attended' },
    )
    return { data: { ...updated, id: String(updated.id) }, meta: { already: false } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
