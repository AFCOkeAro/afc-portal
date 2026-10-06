import type { H3Event } from 'h3'
import type { EventRecord, RegistrationForm } from '@afc/shared'
import { registrationFormSchema, toRegistrationPayload } from '@afc/shared'
import { directusFetch } from '../utils/directus'

/**
 * POST /api/register — the public event registration proxy.
 *
 * This is the only unauthenticated write in the portal and it handles a child's
 * date of birth, guardian contact details, allergies and medical notes, so each
 * decision below is written down rather than left implicit.
 *
 * 1. VALIDATE, THEN PROJECT. The body is parsed with `registrationFormSchema`
 *    and forwarded as `toRegistrationPayload`, which writes exactly the keys in
 *    `PUBLIC_REGISTRATION_FIELDS` plus the server-stamped `source` and
 *    `consent_signed_at`. Nothing else in the submitted body reaches Directus, so
 *    `ticket_code`, `registration_status` and `amount_paid` cannot be supplied by
 *    an anonymous caller even though the collection has those columns.
 *
 * 2. USE A PUBLIC-SCOPED TOKEN. The write is performed with a token whose
 *    Directus policy is the public role's, not with the SSR server token. Using
 *    an application-privileged token on an anonymous path would make the field
 *    allowlist the only thing standing between the internet and every column on
 *    the collection.
 *
 * 3. APPLY THE PUBLIC VISIBILITY FILTER HERE. The server token can read any
 *    event. The anonymous caller may only register for an event whose
 *    `visibility` is `public`, so that filter is applied explicitly instead of
 *    being inherited from a privileged read.
 *
 * NOT IMPLEMENTED, DELIBERATELY
 *   Rate limiting. `data-model` §9 calls for a rate-limited public endpoint and
 *   PRD §7.6 for abuse protection, and neither is in scope for this issue. A
 *   per-instance in-memory limiter would be worse than none: behind more than one
 *   worker, or behind the reverse proxy, the limit that appears to exist is not
 *   the limit that applies. It needs a shared store, which is a decision for the
 *   CTO with the deploy topology. Until then this route is the open door in this
 *   codebase and should be described as such.
 */
interface RegistrationResponse {
  data: {
    id: string
    ticket_code: string | null
    registration_status: string
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The public registration form is closed.',
      data: { code: 'registration_unavailable' },
    })
  }

  const parsed = registrationFormSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Check the highlighted fields and submit again',
      data: {
        code: 'invalid_registration',
        fields: fieldErrors(parsed.error),
      },
    })
  }
  const form = parsed.data

  const eventRow = await loadPublicEvent(event, form.event)
  if (!eventRow) {
    // 404, not 403: an anonymous caller is not told whether an internal event
    // exists.
    throw createError({
      statusCode: 404,
      statusMessage: 'That event is not open for registration',
      data: { code: 'event_not_registerable' },
    })
  }

  if (eventRow.status !== 'published') {
    throw createError({
      statusCode: 409,
      statusMessage: 'That event is not open for registration',
      data: { code: 'event_not_open' },
    })
  }

  if (
    eventRow.registration_opens_at &&
    Date.parse(eventRow.registration_opens_at) > Date.now()
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Registration for that event has not opened yet',
      data: { code: 'registration_not_open' },
    })
  }
  if (
    eventRow.registration_closes_at &&
    Date.parse(eventRow.registration_closes_at) < Date.now()
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Registration for that event has closed',
      data: { code: 'registration_closed' },
    })
  }

  if (eventRow.requires_guardian_consent && !form.guardian_consent) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A guardian must consent to this registration',
      data: {
        code: 'invalid_registration',
        fields: { guardian_consent: 'Guardian consent is required' },
      },
    })
  }

  // Capacity: only confirmed and pending registrations occupy a place, so a
  // cancelled or no-show registration does not silently shrink the event.
  if (eventRow.capacity !== null) {
    const counted = await directusFetch<{ meta: { total: number } }>(
      event,
      '/items/event_registrations',
      {
        method: 'GET',
        accessToken: publicToken,
        query: {
          aggregate: { count: ['registration_status'] },
          filter: {
            event: { _eq: eventRow.id },
            registration_status: { _in: ['pending', 'confirmed'] },
          },
        },
      },
    )
    const taken = Object.values(counted.meta ?? {}).reduce<number>(
      (total, value) => total + (typeof value === 'number' ? value : 0),
      0,
    )
    if (taken >= eventRow.capacity) {
      if (!eventRow.waitlist_enabled) {
        throw createError({
          statusCode: 409,
          statusMessage: 'That event is full',
          data: { code: 'event_full' },
        })
      }
      // Waitlisted rather than refused, per PRD §3.2. The status is set here on
      // the server; it is not a field the public form can send.
      return createRegistration(event, publicToken, form, 'waitlisted')
    }
  }

  return createRegistration(event, publicToken, form, 'pending')
})

async function createRegistration(
  event: H3Event,
  publicToken: string,
  form: RegistrationForm,
  status: 'pending' | 'waitlisted',
) {
  const created = await directusFetch<RegistrationResponse>(
    event,
    '/items/event_registrations',
    {
      method: 'POST',
      accessToken: publicToken,
      body: {
        ...toRegistrationPayload(form),
        registration_status: status,
      },
    },
  )

  return {
    id: created.data.id,
    ticket_code: created.data.ticket_code,
    registration_status: created.data.registration_status,
  }
}

/**
 * Read one event, applying the public visibility filter in the query rather than
 * filtering afterwards. The `fields` list is the same list the public role's
 * policy exposes, so an over-broad policy cannot leak the rest of the row.
 */
async function loadPublicEvent(
  event: H3Event,
  eventId: string,
): Promise<EventRecord | null> {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  const response = await directusFetch<{ data: EventRecord[] }>(event, '/items/events', {
    method: 'GET',
    accessToken: publicToken,
    query: {
      filter: {
        id: { _eq: eventId },
        visibility: { _eq: 'public' },
      },
      limit: 1,
      fields: [
        'id',
        'status',
        'visibility',
        'capacity',
        'waitlist_enabled',
        'requires_guardian_consent',
        'registration_opens_at',
        'registration_closes_at',
      ].join(','),
    },
  })
  return response.data[0] ?? null
}

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    if (key && !fields[key]) fields[key] = issue.message
  }
  return fields
}
