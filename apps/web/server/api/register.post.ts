import type { H3Event } from 'h3'
import { randomUUID } from 'node:crypto'
import type { EventRecord, RegistrationForm } from '@afc/shared'
import { PUBLIC_REGISTRATION_FIELDS, registrationFormSchema } from '@afc/shared'
import { DirectusAuthError, directusFetch } from '../utils/directus'
import { isEventId } from '../utils/event-ids'
import {
  checkPublicRateLimit,
  evictExpiredPublicRateLimitBuckets,
  resolveRateLimitKey,
} from '../utils/public-rate-limit'
import {
  checkEligibilityFlags,
  isHoneypotFilled,
  normalizePublicContact,
  parseAggregateCount,
  publicDedupeKey,
} from '../utils/public-registration-guard'

/**
 * POST /api/register — the public event registration proxy.
 *
 * This is the only unauthenticated write in the portal and it handles a child's
 * date of birth, guardian contact details, allergies and medical notes, so each
 * decision below is written down rather than left implicit.
 *
 * 1. VALIDATE, THEN PROJECT. The body is parsed with `registrationFormSchema`
 *    and forwarded as exactly the 16 keys in `PUBLIC_REGISTRATION_FIELDS` plus
 *    the proxy-assigned `registration_status` and the stamped
 *    `idempotency_key`. Nothing else in the submitted body reaches Directus.
 *    `source` and `consent_signed_at` are NOT sent: the writer grant (G3,
 *    migration 0072) holds no write on them. `source` rides its NOT NULL
 *    column DEFAULT ('public_form'); `consent_signed_at` is stamped to
 *    server time by the 0072 trigger whenever guardian consent is present.
 *    A writer-token caller cannot masquerade a staff walk-in or forge
 *    consent time, and a direct anonymous POST carries no permission at all
 *    (0072 revoked the 0069 public create grant), so it 403s at the data
 *    layer whatever it claims.
 *
 * 2. WRITE THROUGH THE SERVER-HELD WRITER TOKEN (AFC-1226 G3, CTO decision
 *    (a)). The write rides `NUXT_DIRECTUS_WRITER_TOKEN`, whose Directus
 *    policy is the non-public `registration_writer` role: create-only on
 *    event_registrations with the writer allowlist. The token lives in Nuxt
 *    server runtimeConfig only and never reaches the browser. Reads keep
 *    their own least-privilege tokens: the public token reads public events
 *    (visibility=public filter enforced in the query), the server token
 *    runs the capacity pre-check and the replay lookups the writer may not
 *    read. An application-privileged token on an anonymous path would make
 *    the field allowlist the only thing standing between the internet and
 *    every column on the collection.
 *
 * 3. APPLY THE PUBLIC VISIBILITY FILTER HERE. The server token can read any
 *    event. The anonymous caller may only register for an event whose
 *    `visibility` is `public`, so that filter is applied explicitly instead
 *    of being inherited from a privileged read.
 *
 * 4. RATE LIMIT AT THIS EDGE (AFC-1222 F1, AFC-1226 H1/M2). `checkPublicRateLimit`
 *    is a per-instance token bucket keyed by the CDN-attested client IP
 *    (`CF-Connecting-IP`) or the socket peer — never by `X-Forwarded-For`,
 *    which a rotating-XFF flood controls. It throttles an open-day flood on
 *    today's single-process deploys and answers 429 with `Retry-After` (both
 *    the header and the body carry it). It is NOT a shared store: behind more
 *    than one worker the budget is per-worker. The shared store (Redis) is a
 *    CTO deploy-topology decision; `configurePublicRateLimit` is the seam it
 *    lands in, and the stock `caddy:2-alpine` image ships no `rate_limit`
 *    directive, so the limit lives here and not in the Caddyfile (which says
 *    so, and overwrites XFF at the edge for log integrity).
 *
 * 5. SERIALIZED CAPACITY (AFC-1222 F3, AFC-1226 G1/G2). Two layers, because
 *    neither suffices alone: this route pre-checks the taken-seats count with
 *    the SERVER token (the public token holds no read on event_registrations
 *    since 0072, so a public-token count would 403; public visibility is
 *    already enforced by the `loadPublicEvent` visibility=public filter) so a
 *    full event answers 409 without writing, and migrations 0070/0071 install
 *    a BEFORE INSERT trigger — SECURITY DEFINER owned by directus_migrator
 *    (G1), so even a read-less inserting identity gets the named `event_full`
 *    refusal instead of a bare 42501 — that re-counts under a per-event
 *    advisory lock, the layer that makes capacity+1 refused/waitlisted
 *    deterministically under concurrency. When the pre-check itself is
 *    unreadable the route falls through to the write path and lets the
 *    trigger decide, rather than refusing a registration the data layer
 *    would have accepted. The count is read from the aggregate DATA shape
 *    (`data[0].count`), not from `meta`: the old `meta` fold read the wrong
 *    shape and could count zero on a full event.
 *
 *    data-model S9 vs matrix, resolved explicitly: S9 says the public role
 *    has "no read permission on any collection" while the matrix grants
 *    public read on events (public only). The enforced position is the
 *    matrix: the public role reads exactly the 29-field public-event
 *    allowlist (migration 0064) and creates NOTHING (migration 0072 revoked
 *    the 0069 create grant); the writer role creates through the writer
 *    allowlist (migration 0072); the server token reads for pre-check and
 *    replay. S9's sentence needs a CTO-ratified edit to say that; until then
 *    this comment is the resolution, not a silent pick.
 *
 * 6. DEDUPE + IDEMPOTENCY + BOT SIGNAL (AFC-1222 F4, AFC-1226 H2/H3/M1). A
 *    retry with the same normalized (event, name, best contact) replays the
 *    original row with `replay: true` instead of writing a duplicate. The
 *    contact filter is NORMALIZED BEFORE querying (H3): the query carries
 *    raw and normalized phone/email variants so a spaced or cased retry
 *    still narrows, and the full normalized key is compared in code so a
 *    partial probe matches nothing and learns nothing. When the store
 *    cannot be read the route fails CLOSED (503) rather than writing a seat
 *    it cannot dedupe — the client retries with the same `Idempotency-Key`
 *    and the retry is safe. The request's `Idempotency-Key` header is
 *    stamped into `idempotency_key` (H2, sequenced after 0070 created the
 *    column); a 23505 on the partial unique index replays the original row
 *    instead of writing twice. The bot layers are the `website` honeypot —
 *    a filled honeypot gets the IDENTICAL success shape with synthesized
 *    values (`id`, `ticket_code`, `registration_status`; the status runs
 *    through the same gates, nothing is written, so a bot learns nothing)
 *    — plus Turnstile verification whenever `NUXT_TURNSTILE_SECRET_KEY` is
 *    configured. When the secret is absent in PRODUCTION the route fails
 *    closed (503): honeypot-only in prod needs a written CEO
 *    risk-acceptance, it is not a default. Proof-of-work or OTP-verify
 *    before seat allocation is a CTO decision, recorded on the issue, not
 *    smuggled in here.
 *
 * 7. ELIGIBILITY FLAGS (AFC-1222 F5). `age_min`, `age_max` and
 *    `collect_medical` are fetched with the event and enforced: out-of-range
 *    ages fail 400, and medical/emergency content fails 400 when the event
 *    does not collect it.
 */
interface RegistrationResponse {
  data: {
    id: string
    ticket_code: string | null
    registration_status: string
  }
}

interface RegistrationRow {
  id: string
  ticket_code: string | null
  registration_status: string
}

let requestsSinceEviction = 0

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
  // G3: the write rides the server-held writer token, never the public one.
  // Absent means the proxy cannot write without widening the public grant,
  // so the form stays closed instead of failing open.
  const writerToken = String(config.directusWriterToken ?? '')
  if (!writerToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_WRITER_TOKEN is not configured. The public registration form is closed.',
      data: { code: 'registration_writer_unavailable' },
    })
  }
  // G2/H2/H3: the capacity pre-check and both replay lookups ride the
  // server token — the writer is create-only and the public token reads no
  // registrations. Absent means those layers cannot run, so the form stays
  // closed rather than writing blind.
  const serverToken = String(config.directusServerToken ?? '')
  if (!serverToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_SERVER_TOKEN is not configured. The public registration form is closed.',
      data: { code: 'registration_unavailable' },
    })
  }

  // H1: throttle before any store work. The key is the CDN-attested client
  // IP or the socket peer — XFF is never trusted for keying (a rotating-XFF
  // flood walks through an XFF-keyed bucket; see the limiter header).
  const clientKey = resolveRateLimitKey(
    event.node.req.headers as Record<string, string | string[] | undefined>,
    event.node.req.socket?.remoteAddress,
  )
  const limit = checkPublicRateLimit(clientKey)
  requestsSinceEviction += 1
  if (requestsSinceEviction >= 100) {
    requestsSinceEviction = 0
    evictExpiredPublicRateLimitBuckets()
  }
  if (!limit.allowed) {
    // M2: the header AND the body carry the back-off. Header-first clients
    // (CDNs, h11/h2 stacks) read Retry-After; body readers keep retryAfterMs.
    const retrySecs = Math.max(1, Math.ceil(limit.retryAfterMs / 1000))
    setResponseHeader(event, 'Retry-After', retrySecs)
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many registration attempts — try again shortly',
      data: { code: 'rate_limited', retryAfterMs: limit.retryAfterMs },
    })
  }

  const rawBody = ((await readBody(event)) ?? {}) as Record<string, unknown>

  const parsed = registrationFormSchema.safeParse(rawBody)
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

  // Turnstile before any seat work: enforced only when the deploy configured
  // it, fail-closed in production when it did not (H2/H3 decision).
  await verifyTurnstileIfConfigured(event, rawBody)

  const eventRow = await loadPublicEvent(event, publicToken, form.event)
  if (!eventRow) {
    // 404, not 403: an anonymous caller is not told whether an internal event
    // exists.
    throw createError({
      statusCode: 404,
      statusMessage: 'That event is not open for registration',
      data: { code: 'event_not_registerable' },
    })
  }

  // AFC-871 slice 2: the registration section has its own mark. Only
  // `public` registers anonymously; `login`/`custom`/`private`/`draft` fail
  // closed here (404, same as a non-public event — no existence oracle).
  // `custom` has no audience model, so it never passes this gate.
  if (eventRow.registration_visibility !== 'public') {
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

  // F5: the event's age window and medical-collection flag. Checked after
  // the window/consent gates so the cheapest refusals come first.
  const eligibility = checkEligibilityFlags(eventRow, form)
  if (Object.keys(eligibility).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This registration does not meet the event requirements',
      data: { code: 'event_requirements_unmet', fields: eligibility },
    })
  }

  // G2: capacity pre-check with the SERVER token. The writer is create-only
  // and the public token reads no registrations, so neither can count. A
  // full event answers 409 here without writing; an unreadable count falls
  // through to the write path and lets the trigger decide, rather than
  // refusing a registration the data layer would have accepted.
  let seatStatus: 'pending' | 'waitlisted' = 'pending'
  if (eventRow.capacity !== null) {
    const taken = await readTakenSeats(event, serverToken, eventRow.id).catch(() => null)
    if (taken !== null && taken >= eventRow.capacity) {
      if (!eventRow.waitlist_enabled) {
        throw createError({
          statusCode: 409,
          statusMessage: 'That event is full',
          data: { code: 'event_full' },
        })
      }
      // Waitlisted rather than refused, per PRD §3.2. The status is set here on
      // the server; it is not a field the public form can send.
      seatStatus = 'waitlisted'
    }
  }

  // M1 honeypot: AFTER the gates, so the synthesized success runs through
  // the same status the event currently resolves to. Identical shape to a
  // real success, synthesized values, nothing written, no replay flag (it
  // never was a row) — a bot learns nothing a legitimate client doesn't.
  if (isHoneypotFilled(rawBody)) {
    return {
      id: randomUUID(),
      ticket_code: null,
      registration_status: seatStatus,
    }
  }

  // H2: the client-supplied idempotency key, stamped into idempotency_key.
  // Malformed keys degrade to key-less (contact dedupe still guards) rather
  // than stranding a legitimate retry on a 400.
  const idempotencyKey = resolveIdempotencyKey(event)

  // H3 dedupe: a retry with the same normalized key replays the original
  // row. The writer token cannot read this collection and the public token
  // reads none of it, so the lookup rides the server token and matches the
  // FULL key in code — a partial probe matches nothing and learns nothing.
  // A store error fails closed (503): the client retries with the same
  // Idempotency-Key and the retry is safe.
  const replay = await findDupeReplay(event, serverToken, form)
  if (replay) {
    return { ...replay, replay: true as const }
  }

  return createWithRaceGuard(event, { writerToken, serverToken }, form, seatStatus, {
    waitlistEnabled: eventRow.waitlist_enabled,
    idempotencyKey,
  })
})

/**
 * Read the taken-seats count for one event with the server token (G2).
 * Only confirmed and pending registrations occupy a place, so a cancelled
 * or no-show registration does not silently shrink the event.
 */
async function readTakenSeats(
  event: H3Event,
  serverToken: string,
  eventId: string,
): Promise<number> {
  const counted = await directusFetch<{ data: Array<{ count: number | string }> }>(
    event,
    '/items/event_registrations',
    {
      method: 'GET',
      accessToken: serverToken,
      query: {
        aggregate: { count: '*' },
        filter: {
          event: { _eq: eventId },
          registration_status: { _in: ['pending', 'confirmed'] },
        },
      },
    },
  )
  // The data shape, not meta. parseAggregateCount keeps the legacy meta
  // fold as a fallback so a version-skewed response counts instead of
  // silently reading zero.
  return parseAggregateCount(counted)
}

/**
 * F3 race guard, extended for idempotency (H2). The trigger (migrations
 * 0070/0071) refuses a seat-occupying insert that loses the concurrent race
 * with `event_full`. A raw refusal would surface as a 502; instead it is
 * mapped back onto the product answer: waitlisted where the event
 * overflows, 409 where it does not. The waitlist retry writes a
 * non-seat-occupying row, so it cannot race.
 *
 * A 23505 on the (event, idempotency_key) index means the retry already
 * landed: the original row is replayed. When the original cannot be read
 * back the route fails closed (503) — the client retries with the same
 * key, and the retry stays safe.
 *
 * A permission refusal on the writer POST (Directus 401/403) is a deploy
 * fault, NOT a capacity signal: it answers 503 and never masquerades as
 * "event full". (G1's definer fix means the data-layer 42501 that used to
 * escape the gate is gone; what survives to this layer is misconfiguration,
 * and misconfiguration must page, not misreport.)
 */
async function createWithRaceGuard(
  event: H3Event,
  tokens: { writerToken: string; serverToken: string },
  form: RegistrationForm,
  status: 'pending' | 'waitlisted',
  options: { waitlistEnabled: boolean; idempotencyKey: string | null },
): Promise<RegistrationRow | (RegistrationRow & { replay: true })> {
  try {
    return await createRegistration(
      event,
      tokens.writerToken,
      form,
      status,
      options.idempotencyKey,
    )
  } catch (error) {
    if (isEventFullRefusal(error)) {
      if (status === 'waitlisted' || !options.waitlistEnabled) {
        throw createError({
          statusCode: 409,
          statusMessage: 'That event is full',
          data: { code: 'event_full' },
        })
      }
      return createRegistration(
        event,
        tokens.writerToken,
        form,
        'waitlisted',
        options.idempotencyKey,
      )
    }
    if (isIdempotencyDuplicate(error)) {
      const replay = await findIdempotencyReplay(
        event,
        tokens.serverToken,
        form.event,
        options.idempotencyKey,
      ).catch(() => null)
      if (replay) return { ...replay, replay: true as const }
      throw createError({
        statusCode: 503,
        statusMessage: 'The registration could not be confirmed — submit again',
        data: { code: 'registration_store_unreadable' },
      })
    }
    if (error instanceof DirectusAuthError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'The registration service is not configured correctly',
        data: { code: 'registration_writer_unavailable' },
      })
    }
    throw error
  }
}

function refusalMessages(error: unknown): Array<unknown> {
  const shaped = error as {
    message?: unknown
    statusMessage?: unknown
    data?: {
      errors?: Array<{ message?: unknown }>
      upstreamMessage?: unknown
      upstreamCode?: unknown
      code?: unknown
    }
  }
  // AFC-1230 F1: the 5xx branch of mapDirectusError strips upstream text
  // from message/statusMessage (AFC-654) and preserves it in
  // data.upstreamMessage / data.upstreamCode instead. Read the preserved
  // signal here so a concurrent last-seat loser still maps to 409/waitlist
  // and a 23505 replay still maps to replay:true instead of 502.
  return [
    shaped?.message,
    shaped?.statusMessage,
    shaped?.data?.errors?.[0]?.message,
    shaped?.data?.upstreamMessage,
    shaped?.data?.upstreamCode,
    shaped?.data?.code,
  ]
}

function isEventFullRefusal(error: unknown): boolean {
  return refusalMessages(error).some(
    (part) => typeof part === 'string' && part.includes('event_full'),
  )
}

function isIdempotencyDuplicate(error: unknown): boolean {
  return refusalMessages(error).some(
    (part) =>
      typeof part === 'string' &&
      (part.includes('event_registrations_event_idem_key') ||
        part.includes('duplicate key') ||
        part.includes('23505')),
  )
}

/**
 * Project the validated form onto the writer-writable set (G3): exactly the
 * 16 PUBLIC_REGISTRATION_FIELDS. The proxy-assigned `registration_status`
 * and the stamped `idempotency_key` are added by the caller; `source` and
 * `consent_signed_at` are never sent — the writer grant holds no write on
 * them (0072 stamps them server-side).
 */
function toWriterPayload(form: RegistrationForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of PUBLIC_REGISTRATION_FIELDS) {
    payload[field] = (form as Record<string, unknown>)[field] ?? null
  }
  return payload
}

async function createRegistration(
  event: H3Event,
  writerToken: string,
  form: RegistrationForm,
  status: 'pending' | 'waitlisted',
  idempotencyKey: string | null,
): Promise<RegistrationRow> {
  const created = await directusFetch<RegistrationResponse>(
    event,
    '/items/event_registrations',
    {
      method: 'POST',
      accessToken: writerToken,
      body: {
        ...toWriterPayload(form),
        registration_status: status,
        idempotency_key: idempotencyKey,
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
 * H2: stamp the client-supplied `Idempotency-Key` header. 1–128 chars after
 * trimming; absent or absurd degrades to key-less (the contact dedupe still
 * guards) rather than stranding a retry on a 400.
 */
function resolveIdempotencyKey(event: H3Event): string | null {
  const header = getRequestHeader(event, 'idempotency-key')
  const key = (Array.isArray(header) ? header[0] : (header ?? '')).trim()
  if (!key || key.length > 128) return null
  return key
}

/**
 * H3 dedupe filter. The contact fragments are NORMALIZED BEFORE filtering:
 * the query carries both the raw and the normalized phone/email variants so
 * a spaced or cased retry still narrows server-side; the exact match then
 * happens in code on both-sides-normalized keys, so a partial probe matches
 * nothing. No contact at all degrades to the (event, name) narrow — the
 * same precedence as the stored key (phone wins, else email, else name).
 */
function buildDedupeFilter(form: RegistrationForm): Record<string, unknown> {
  const ors: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  const push = (field: 'phone' | 'email', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const key = `${field}:${trimmed}`
    if (seen.has(key)) return
    seen.add(key)
    ors.push({ [field]: { _eq: trimmed } })
  }
  for (const field of ['phone', 'email'] as const) {
    const raw = String((form as Record<string, unknown>)[field] ?? '')
    push(field, raw)
    push(field, normalizePublicContact(raw))
  }
  if (ors.length > 0) {
    return { event: { _eq: form.event }, _or: ors }
  }
  return {
    event: { _eq: form.event },
    registrant_first_name: { _eq: form.registrant_first_name },
    registrant_last_name: { _eq: form.registrant_last_name },
  }
}

async function readDedupeCandidates(
  event: H3Event,
  serverToken: string,
  filter: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const response = await directusFetch<{ data: Array<Record<string, unknown>> }>(
    event,
    '/items/event_registrations',
    {
      method: 'GET',
      accessToken: serverToken,
      query: {
        filter,
        limit: 25,
        fields:
          'id,ticket_code,registration_status,registrant_first_name,registrant_last_name,email,phone',
      },
    },
  )
  return response.data ?? []
}

/**
 * H3 replay lookup. The writer token is create-only and the public token
 * reads no registrations, so this rides the server token. Fails CLOSED:
 * one re-read, then 503 — writing a seat the route cannot dedupe is how a
 * retry becomes a duplicate. The client retries with the same
 * Idempotency-Key and the retry stays safe.
 */
async function findDupeReplay(
  event: H3Event,
  serverToken: string,
  form: RegistrationForm,
): Promise<RegistrationRow | null> {
  const wanted = publicDedupeKey(form.event, form)
  const filter = buildDedupeFilter(form)
  let rows = await readDedupeCandidates(event, serverToken, filter).catch(() => null)
  if (!rows)
    rows = await readDedupeCandidates(event, serverToken, filter).catch(() => null)
  if (!rows) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The registration store could not be read — try again shortly',
      data: { code: 'registration_store_unreadable' },
    })
  }
  for (const row of rows) {
    if (publicDedupeKey(form.event, row) === wanted) {
      return {
        id: String(row.id),
        ticket_code: (row.ticket_code as string | null) ?? null,
        registration_status: String(row.registration_status ?? 'pending'),
      }
    }
  }
  return null
}

/**
 * H2 idempotency replay: the (event, key) row the 23505 says already exists.
 * Null when it cannot be read back — the caller fails closed.
 */
async function findIdempotencyReplay(
  event: H3Event,
  serverToken: string,
  eventId: string,
  idempotencyKey: string | null,
): Promise<RegistrationRow | null> {
  if (!idempotencyKey) return null
  const response = await directusFetch<{ data: Array<Record<string, unknown>> }>(
    event,
    '/items/event_registrations',
    {
      method: 'GET',
      accessToken: serverToken,
      query: {
        filter: { event: { _eq: eventId }, idempotency_key: { _eq: idempotencyKey } },
        limit: 1,
        fields: 'id,ticket_code,registration_status',
      },
    },
  )
  const row = response.data[0]
  if (!row) return null
  return {
    id: String(row.id),
    ticket_code: (row.ticket_code as string | null) ?? null,
    registration_status: String(row.registration_status ?? 'pending'),
  }
}

/**
 * Turnstile verification (AFC-1222 F4, AFC-1226 fail-closed). When the
 * deploy configured the secret, the client must send `turnstile_token` and
 * Cloudflare must accept it, before any seat is allocated. When the secret
 * is absent the deploy has not enabled bot enforcement: outside production
 * the honeypot + rate limit + dedupe stay the active layers and the route
 * says so; IN PRODUCTION the form closes (503) — honeypot-only in prod
 * needs a written CEO risk-acceptance, it is never a silent default.
 */
async function verifyTurnstileIfConfigured(
  event: H3Event,
  body: Record<string, unknown>,
): Promise<void> {
  const config = useRuntimeConfig(event)
  const secret = String(config.turnstileSecretKey ?? '')
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw createError({
        statusCode: 503,
        statusMessage:
          'Human verification is not configured for this deployment. The public registration form is closed.',
        data: { code: 'bot_verification_unavailable' },
      })
    }
    return
  }
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Complete the human verification and submit again',
      data: { code: 'bot_verification_required' },
    })
  }
  let ok: boolean
  try {
    const verdict = await $fetch<{ success?: boolean }>(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    )
    ok = verdict?.success === true
  } catch {
    ok = false
  }
  if (!ok) {
    throw createError({
      statusCode: 403,
      statusMessage: 'The human verification did not pass — try again',
      data: { code: 'bot_verification_failed' },
    })
  }
}

/**
 * Read one event, applying the public visibility filter in the query rather
 * than filtering afterwards. The `fields` list is the same list the public
 * role's policy exposes, so an over-broad policy cannot leak the rest of the
 * row. F5 adds the eligibility flags to that list: they describe the event,
 * not a child, so they belong in the public allowlist (migration 0064
 * already carries them).
 */
async function loadPublicEvent(
  event: H3Event,
  publicToken: string,
  eventId: string,
): Promise<
  | (EventRecord & {
      age_min: number | null
      age_max: number | null
      collect_medical: boolean
    })
  | null
> {
  // Malformed ids can never match a UUID row: fail closed to the
  // existing 404 instead of letting Postgres throw (503). Client-side
  // the picker only offers public events, so this is unreachable anyway.
  if (!isEventId(eventId)) return null
  const response = await directusFetch<{
    data: Array<
      EventRecord & {
        age_min: number | null
        age_max: number | null
        collect_medical: boolean
      }
    >
  }>(event, '/items/events', {
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
        'registration_visibility',
        'capacity',
        'waitlist_enabled',
        'requires_guardian_consent',
        'registration_opens_at',
        'registration_closes_at',
        'age_min',
        'age_max',
        'collect_medical',
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
