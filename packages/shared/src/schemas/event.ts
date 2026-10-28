/**
 * Events.
 *
 * `start_at` before `end_at` is a cross-field rule, so it lives in
 * `superRefine` rather than on either field. A single-field rule would let a
 * form submit a service that ends before it starts.
 */
import { z } from 'zod'
import { dateTimeSchema, moneySchema, optionalNote, optionalText } from './common'

const EVENT_TYPES = [
  'service',
  'summit',
  'camp',
  'training',
  'outreach',
  'social',
  'other',
] as const

const CURRENCIES = ['NGN', 'USD', 'GBP'] as const

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    summary: optionalText(500),
    description: optionalNote(),
    event_type: z.enum(EVENT_TYPES).default('other'),
    /** Omitted for an area-wide event (data-model §3.1). */
    branch: optionalText(36),
    start_at: dateTimeSchema,
    end_at: dateTimeSchema,
    location: optionalText(255),
    address: optionalNote(),
    /** Absent means unlimited capacity. */
    capacity: z.coerce.number().int().min(0).optional(),
    waitlist_enabled: z.boolean().default(false),
    registration_opens_at: dateTimeSchema
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    registration_closes_at: dateTimeSchema
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    fee_amount: moneySchema,
    currency: z.enum(CURRENCIES).default('NGN'),
    // AFC-830: charging is opt-in per event. The fee/currency fields below
    // only render when this is on; the route stores whatever the form
    // sends, so an off event simply never sends a fee.
    payments_enabled: z.boolean().default(false),
    requires_guardian_consent: z.boolean().default(false),
    collect_medical: z.boolean().default(false),
    age_min: z.coerce.number().int().min(0).optional(),
    age_max: z.coerce.number().int().min(0).optional(),
    visibility: z.enum(['public', 'branch', 'internal']).default('branch'),
    status: z.enum(['draft', 'published', 'closed', 'cancelled']).default('draft'),
  })
  .superRefine((form, ctx) => {
    if (Date.parse(form.end_at) <= Date.parse(form.start_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_at'],
        message: 'The event must end after it starts',
      })
    }
    if (form.registration_opens_at && form.registration_closes_at) {
      if (
        Date.parse(form.registration_closes_at) <= Date.parse(form.registration_opens_at)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['registration_closes_at'],
          message: 'Registration must close after it opens',
        })
      }
    }
    if (form.age_min !== undefined && form.age_max !== undefined) {
      if (form.age_max < form.age_min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['age_max'],
          message: 'The maximum age must not be below the minimum age',
        })
      }
    }
  })

export type EventForm = z.infer<typeof eventFormSchema>
export type EventFormInput = z.input<typeof eventFormSchema>

/**
 * Is registration open right now?
 *
 * `registration_open` is described in data-model §3.1 as "derived from window,
 * but overridable". An override is the staff member's decision and wins; with no
 * override the window decides.
 */
export function isRegistrationOpen(
  event: {
    registration_open?: boolean
    registration_opens_at?: string | null
    registration_closes_at?: string | null
  },
  now: Date = new Date(),
): boolean {
  if (typeof event.registration_open === 'boolean') return event.registration_open
  const opens = event.registration_opens_at
  const closes = event.registration_closes_at
  if (!opens && !closes) return true
  const at = now.getTime()
  if (opens && at < Date.parse(opens)) return false
  if (closes && at > Date.parse(closes)) return false
  return true
}

/** Does a person of this age fall inside the event's eligibility window? */
export function isAgeEligible(
  event: { age_min?: number | null; age_max?: number | null },
  age: number | null,
): boolean {
  if (age === null) return true
  if (event.age_min != null && age < event.age_min) return false
  if (event.age_max != null && age > event.age_max) return false
  return true
}

export function toEventPayload(form: EventForm): Record<string, unknown> {
  return {
    title: form.title,
    summary: form.summary ?? null,
    description: form.description ?? null,
    event_type: form.event_type,
    branch: form.branch ?? null,
    start_at: form.start_at,
    end_at: form.end_at,
    location: form.location ?? null,
    address: form.address ?? null,
    capacity: form.capacity ?? null,
    waitlist_enabled: form.waitlist_enabled,
    registration_opens_at: form.registration_opens_at ?? null,
    registration_closes_at: form.registration_closes_at ?? null,
    fee_amount: form.fee_amount,
    currency: form.currency,
    payments_enabled: form.payments_enabled,
    requires_guardian_consent: form.requires_guardian_consent,
    collect_medical: form.collect_medical,
    age_min: form.age_min ?? null,
    age_max: form.age_max ?? null,
    visibility: form.visibility,
    status: form.status,
  }
}
