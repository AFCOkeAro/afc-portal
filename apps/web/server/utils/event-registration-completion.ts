import { PUBLIC_REGISTRATION_FIELDS, registrationFormSchema } from '@afc/shared'
import type { RegistrationForm } from '@afc/shared'

/**
 * Staff event-registration completion (AFC-470, AFC-462 workstream B).
 *
 * Pure helpers behind the staff routes so the transition, payment and
 * idempotency rules are unit-testable without Directus:
 *
 *   POST /api/events/[id]/registrations        staff walk-in/phone create
 *   PATCH /api/events/registrations/[id]       status + payment reconciliation
 *   POST /api/events/[id]/check-in             ticket-code or name check-in
 *   POST /api/events/[id]/group-registrations  atomic N-member group create
 *   GET  /api/events/[id]/rollups              header aggregates, no summary tables
 *
 * Source-name note: the issue text says `source='staff_walkin'`, but the
 * ratified PRD (docs/planning/prd.md US-5 AC1: "source = staff") and the
 * data-model (docs/planning/data-model.md: `public_form`, `staff`) allow
 * only `public_form` | `staff`. This helper stamps `staff`, NOT 'staff_walkin',
 * and the choice is recorded on the issue thread. If the board wants a third enum value it is
 * a data-model change with a migration, not a route default.
 *
 * The public allowlist (`packages/shared/src/schemas/registration.ts`) is
 * NOT touched here: staff create reuses `registrationFormSchema` for the
 * person fields and then stamps the server-owned columns itself.
 */

export const STAFF_SOURCE = 'staff' as const

/**
 * Client-owned columns on staff create are exactly the public allowlist.
 * `ticket_code` and `registration_status` are assigned by the Flow (public)
 * or by the staff route default (pending here) — never accepted from the
 * client, on either path.
 */
export const STAFF_CREATE_FORBIDDEN_FIELDS = [
  'ticket_code',
  'registration_status',
] as const

export type StaffRegistrationStatus =
  'pending' | 'confirmed' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show'

/**
 * Allowed status edges. Terminal states (`attended`, `cancelled`, `no_show`)
 * have no outgoing edge: a mistaken check-in is corrected by a new
 * registration or a CTO-approved data fix, never by flipping the row back.
 */
export const STATUS_TRANSITIONS: Record<
  StaffRegistrationStatus,
  readonly StaffRegistrationStatus[]
> = {
  pending: ['confirmed', 'waitlisted', 'cancelled'],
  waitlisted: ['confirmed', 'pending', 'cancelled'],
  confirmed: ['attended', 'cancelled', 'no_show'],
  attended: [],
  cancelled: [],
  no_show: [],
}

export function isStatusTransitionAllowed(
  from: StaffRegistrationStatus,
  to: StaffRegistrationStatus,
): boolean {
  if (from === to) return true
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertStatusTransitionAllowed(
  from: StaffRegistrationStatus,
  to: StaffRegistrationStatus,
): void {
  if (isStatusTransitionAllowed(from, to)) return
  throw createError({
    statusCode: 409,
    statusMessage: `Cannot move a registration from ${from} to ${to}`,
    data: { code: 'invalid_status_transition', from, to },
  })
}

export const PAYMENT_STATUSES = ['not_required', 'pending', 'paid', 'refunded'] as const

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN as unknown as null
  return parsed
}

/**
 * Validate the payment half of the PATCH route. Returns a field-error map
 * (empty when valid) so the route can throw the standard 400 shape.
 * Smallest defensible rules: amounts must be non-negative numbers; `paid`
 * needs an amount actually collected; `refunded` needs something to refund.
 */
export function validatePaymentPatch(
  body: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {}
  const status = body.payment_status
  if (
    status !== undefined &&
    !(PAYMENT_STATUSES as readonly unknown[]).includes(status)
  ) {
    fields.payment_status = 'Pick not_required, pending, paid or refunded'
  }
  const expected =
    body.amount_expected !== undefined ? toAmount(body.amount_expected) : undefined
  const paid = body.amount_paid !== undefined ? toAmount(body.amount_paid) : undefined
  if (expected !== undefined && expected !== null && Number.isNaN(expected)) {
    fields.amount_expected = 'Enter a non-negative amount'
  }
  if (paid !== undefined && paid !== null && Number.isNaN(paid)) {
    fields.amount_paid = 'Enter a non-negative amount'
  }
  if (status === 'paid' && (paid === undefined || paid === null || paid === 0)) {
    fields.amount_paid = 'Record the amount collected before marking paid'
  }
  if (status === 'refunded' && (paid === undefined || paid === null || paid === 0)) {
    fields.amount_paid = 'Record the amount refunded before marking refunded'
  }
  return fields
}

/**
 * Project a validated staff form onto the allowlist and stamp the
 * server-owned columns. Mirrors `toRegistrationPayload` with the staff
 * source; the Flow still assigns `ticket_code` / `registration_status`
 * (defaulted to `pending` at the route until the Flow runs).
 */
export function toStaffPayload(form: RegistrationForm): Record<string, unknown> {
  const parsed = registrationFormSchema.parse({ ...form, event: form.event })
  const payload: Record<string, unknown> = {
    source: STAFF_SOURCE,
    registration_status: 'pending',
    consent_signed_at: parsed.guardian_consent ? new Date().toISOString() : null,
  }
  for (const field of PUBLIC_REGISTRATION_FIELDS) {
    payload[field] = parsed[field] ?? null
  }
  return payload
}

/** Normalise one contact for idempotency: lowercase, trim, drop spaces. */
export function normalizeMemberContact(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

/**
 * Idempotency key for one group member: (event, group_code, name + best
 * contact). Phone wins when present, else email, else the name alone —
 * matching the issue's "(event, group_code, normalized phone/email+name)".
 */
export function groupMemberKey(
  eventId: string,
  groupCode: string,
  member: {
    registrant_first_name?: unknown
    registrant_last_name?: unknown
    email?: unknown
    phone?: unknown
  },
): string {
  const name = `${normalizeMemberContact(member.registrant_first_name)}|${normalizeMemberContact(member.registrant_last_name)}`
  const contact =
    normalizeMemberContact(member.phone) ||
    normalizeMemberContact(member.email) ||
    'no-contact'
  return [String(eventId), String(groupCode).trim().toLowerCase(), name, contact].join(
    ':',
  )
}

/**
 * Split a group submission into rows to create vs replays to skip, given
 * the keys already stored for (event, group_code). A retry with the same
 * key set creates zero new rows; the route answers the replay with the
 * original rows instead of writing duplicates.
 */
export function splitGroupReplay(
  existingKeys: ReadonlySet<string> | readonly string[],
  eventId: string,
  groupCode: string,
  members: Array<{
    registrant_first_name?: unknown
    registrant_last_name?: unknown
    email?: unknown
    phone?: unknown
  }>,
): { toCreate: typeof members; skipped: typeof members } {
  const seen = existingKeys instanceof Set ? existingKeys : new Set(existingKeys)
  const toCreate: typeof members = []
  const skipped: typeof members = []
  const batch = new Set<string>()
  for (const member of members) {
    const key = groupMemberKey(eventId, groupCode, member)
    if (seen.has(key) || batch.has(key)) {
      skipped.push(member)
      continue
    }
    batch.add(key)
    toCreate.push(member)
  }
  return { toCreate, skipped }
}

export interface RollupRow {
  registration_status: StaffRegistrationStatus | string | null
  amount_expected: string | number | null
  amount_paid: string | number | null
}

export interface RegistrationRollups {
  registered: number
  confirmed: number
  attended: number
  expected: number
  collected: number
  outstanding: number
  byStatus: Record<string, number>
}

/**
 * Header aggregates for the event detail page (AFC-470 §5). Pure fold over
 * the rows the detail route already loads — no summary tables. Cancelled
 * rows leave the headcount but never the money.
 */
export function summarizeRegistrations(rows: readonly RollupRow[]): RegistrationRollups {
  const byStatus: Record<string, number> = {}
  let confirmed = 0
  let attended = 0
  let expected = 0
  let collected = 0
  for (const row of rows) {
    const status = String(row.registration_status ?? 'unknown')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    if (status === 'confirmed') confirmed += 1
    if (status === 'attended') attended += 1
    if (status === 'cancelled') continue
    const exp = Number(row.amount_expected ?? 0)
    const got = Number(row.amount_paid ?? 0)
    if (Number.isFinite(exp)) expected += exp
    if (Number.isFinite(got)) collected += got
  }
  return {
    registered: rows.filter((row) => row.registration_status !== 'cancelled').length,
    confirmed,
    attended,
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
    byStatus,
  }
}

export type CheckInQuery = { ticket_code?: unknown; name?: unknown }

export type CheckInResolution =
  | { kind: 'match'; row: unknown }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'not_found' }

/**
 * Resolve a check-in query against the event's rows. Ticket code is exact
 * (case-insensitive, trimmed); name is a case-insensitive substring over
 * "first last" that must narrow to exactly one non-cancelled row, otherwise
 * the route asks staff to disambiguate rather than checking in the wrong
 * person — these rows include minors.
 */
export function resolveCheckIn(
  rows: ReadonlyArray<Record<string, unknown>>,
  query: CheckInQuery,
): CheckInResolution {
  const ticket = String(query.ticket_code ?? '')
    .trim()
    .toLowerCase()
  if (ticket) {
    const hit = rows.find(
      (row) =>
        String(row.ticket_code ?? '')
          .trim()
          .toLowerCase() === ticket,
    )
    return hit ? { kind: 'match', row: hit } : { kind: 'not_found' }
  }
  const name = String(query.name ?? '')
    .trim()
    .toLowerCase()
  if (!name) return { kind: 'not_found' }
  const live = rows.filter((row) => row.registration_status !== 'cancelled')
  const hits = live.filter((row) =>
    `${String(row.registrant_first_name ?? '')} ${String(row.registrant_last_name ?? '')}`
      .trim()
      .toLowerCase()
      .includes(name),
  )
  if (hits.length === 1) return { kind: 'match', row: hits[0] }
  if (hits.length > 1) return { kind: 'ambiguous', count: hits.length }
  return { kind: 'not_found' }
}
