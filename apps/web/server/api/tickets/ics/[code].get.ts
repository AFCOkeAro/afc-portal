import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { directusFetch } from '../../../utils/directus'
import { buildTicketIcs } from '../../../utils/ticket-delivery'

interface RegistrationRow {
  id: string
  ticket_code: string
  registrant_first_name: string
  registrant_last_name: string
  event: string
}

interface EventRow {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string | null
}

/**
 * Public .ics download for one ticket (AFC-1250).
 *
 * The ticket code is the bearer secret already printed in the email/QR. The
 * lookup returns only the fields the calendar needs (registrant name, code,
 * event facts); no DOB, medical, allergies, or emergency contacts are read or
 * emitted (F3). Dates come from the event row, never hardcoded. The `ics`
 * package owns escaping/folding; TZID is Africa/Lagos (WAT, no DST).
 */
export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'code')
  const code = typeof raw === 'string' ? raw.trim() : ''
  if (!code || code.length > 64 || !/^[A-Za-z0-9._-]+$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid ticket code is required' })
  }

  const registrations = await directusFetch<{ data: RegistrationRow[] }>(
    event,
    '/items/event_registrations',
    {
      query: {
        filter: { ticket_code: { _eq: code } },
        limit: 1,
        fields: 'id,ticket_code,registrant_first_name,registrant_last_name,event',
      },
    },
  )
  const registration = registrations.data?.[0]
  if (!registration) {
    throw createError({ statusCode: 404, statusMessage: 'That ticket was not found' })
  }

  const eventResponse = await directusFetch<{ data: EventRow }>(
    event,
    `/items/events/${registration.event}`,
    {
      query: { fields: 'id,title,start_at,end_at,location' },
    },
  )
  const eventRow = eventResponse.data
  const registrantName =
    `${registration.registrant_first_name} ${registration.registrant_last_name}`.trim()

  const ics = buildTicketIcs({
    eventName: eventRow.title,
    startsAt: eventRow.start_at,
    endsAt: eventRow.end_at,
    location: eventRow.location ?? '',
    ticketCode: registration.ticket_code,
    registrantName,
    organizerEmail: 'events@afcokearo.org',
  })

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="afc-ticket-${registration.ticket_code}.ics"`)
  setHeader(event, 'Cache-Control', 'private, max-age=0, no-store')
  return ics
})
