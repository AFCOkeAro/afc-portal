/**
 * Pure helpers behind POST /api/register (AFC-1222 F3–F5).
 *
 * Everything here is unit-testable without Directus: the route is a thin
 * shell over these functions plus two Directus calls. Rules:
 *
 *   - Aggregate shape (F3). The capacity count is read from the response
 *     DATA shape (`data[0].count`), not from `meta`. The old code folded
 *     `meta` values, which is the wrong shape for an aggregate query and
 *     silently counted zero on some Directus versions — an event that looks
 *     empty is an event that overbooks.
 *   - Eligibility flags (F5). `age_min`, `age_max` and `collect_medical`
 *     are event flags the route must fetch and enforce: out-of-range ages
 *     fail 400, and medical/emergency content fails 400 when the event does
 *     not collect it.
 *   - Dedupe key (F4). (event, normalized contact + name), mirroring the
 *     group-registration key in event-registration-completion.ts. The public
 *     route has no group_code, so the key is (event, name, best contact).
 */

export interface CapacityAggregateResponse {
  data?: Array<{ count?: unknown }>
  meta?: Record<string, unknown>
}

/**
 * Read the taken-seats count from an aggregate response. Prefers the data
 * shape; falls back to summing numeric meta values for older responses.
 * Never throws: an unreadable count is 0 and the caller treats the store
 * as unavailable separately.
 */
export function parseAggregateCount(response: CapacityAggregateResponse | null | undefined): number {
  const first = response?.data?.[0]?.count
  if (typeof first === 'number' && Number.isFinite(first)) return Math.max(0, Math.floor(first))
  if (typeof first === 'string' && first.trim() !== '' && Number.isFinite(Number(first))) {
    return Math.max(0, Math.floor(Number(first)))
  }
  if (response?.meta && typeof response.meta === 'object') {
    let total = 0
    let seen = false
    for (const value of Object.values(response.meta)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        total += value
        seen = true
      }
    }
    if (seen) return Math.max(0, Math.floor(total))
  }
  return 0
}

/** Normalise one contact fragment for idempotency: lowercase, trim, drop spaces. */
export function normalizePublicContact(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

/**
 * Dedupe key for one public registration: (event, name, best contact).
 * Phone wins when present, else email, else the name alone — the same
 * precedence as groupMemberKey, minus the group_code the public route
 * does not have.
 */
export function publicDedupeKey(
  eventId: string,
  member: {
    registrant_first_name?: unknown
    registrant_last_name?: unknown
    email?: unknown
    phone?: unknown
  },
): string {
  const name = `${normalizePublicContact(member.registrant_first_name)}|${normalizePublicContact(member.registrant_last_name)}`
  const contact =
    normalizePublicContact(member.phone) ||
    normalizePublicContact(member.email) ||
    'no-contact'
  return [String(eventId), name, contact].join(':')
}

/** Whole years of age at `now` from an ISO date string. Null when unparseable. */
export function ageInYears(dateOfBirth: string | undefined, now: Date = new Date()): number | null {
  if (typeof dateOfBirth !== 'string' || dateOfBirth.trim() === '') return null
  const born = Date.parse(`${dateOfBirth.trim()}T00:00:00Z`)
  if (Number.isNaN(born)) return null
  let age = now.getUTCFullYear() - new Date(born).getUTCFullYear()
  const birthdayThisYear = new Date(born)
  birthdayThisYear.setUTCFullYear(now.getUTCFullYear())
  if (birthdayThisYear.getTime() > now.getTime()) age -= 1
  return age
}

export interface EligibilityFlags {
  age_min: number | null
  age_max: number | null
  collect_medical: boolean
}

/**
 * F5 eligibility: the event's age window and medical-collection flag.
 * Returns the field-error map (empty when eligible) so the route throws
 * the standard 400 shape. A DOB the schema accepted but that falls outside
 * the event's window refuses here; medical/emergency content refuses when
 * the event does not collect it.
 */
export function checkEligibilityFlags(
  flags: EligibilityFlags,
  form: {
    date_of_birth?: string | undefined
    age_group?: string | undefined
    medical_notes?: unknown
    allergies?: unknown
    emergency_contact_name?: unknown
    emergency_contact_phone?: unknown
  },
  now: Date = new Date(),
): Record<string, string> {
  const fields: Record<string, string> = {}
  const age = ageInYears(form.date_of_birth, now)
  if (age !== null) {
    if (flags.age_min !== null && age < flags.age_min) {
      fields.date_of_birth = `This event is for ages ${flags.age_min} and above`
    } else if (flags.age_max !== null && age > flags.age_max) {
      fields.date_of_birth = `This event is for ages up to ${flags.age_max}`
    }
  } else if (form.age_group !== undefined && form.age_group !== 'unknown') {
    // No DOB to measure against the window: the window cannot be checked,
    // so it is not checked. Stating the limit beats silently passing.
    if (flags.age_min !== null || flags.age_max !== null) {
      fields.date_of_birth = 'Give a date of birth so we can check the age range for this event'
    }
  }
  if (!flags.collect_medical) {
    const hasMedical =
      Boolean(form.medical_notes) ||
      Boolean(form.allergies) ||
      Boolean(form.emergency_contact_name) ||
      Boolean(form.emergency_contact_phone)
    if (hasMedical) {
      fields.medical_notes = 'This event does not collect medical or emergency details'
    }
  }
  return fields
}

/**
 * F4 bot signal, cheapest layer: the form carries a honeypot field
 * (`website`) that the real page never renders. A filled honeypot is a bot,
 * not a registrant. The field is never in PUBLIC_REGISTRATION_FIELDS and is
 * never forwarded, so it cannot reach Directus either way.
 */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body.website ?? body.company_website ?? body.url
  return typeof value === 'string' && value.trim() !== ''
}
