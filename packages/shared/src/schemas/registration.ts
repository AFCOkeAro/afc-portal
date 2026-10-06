/**
 * Public event registration.
 *
 * This is the only unauthenticated write path in the portal, and it collects a
 * child's date of birth, guardian contact details, allergies and medical notes.
 * Two properties follow from that and are enforced here rather than in the
 * route, so that the browser, a Directus Flow and a future second client all
 * apply the same rule:
 *
 *  1. The submitted field set is an ALLOWLIST. The server route is required to
 *     forward exactly these keys and nothing else, so no future client can send
 *     `registration_status: 'attended'` or `ticket_code` into a public form.
 *     data-model §9 grants the public role "create-only on event_registrations
 *     via an allowlisted field set"; the ticket code and status are the Flow's
 *     to assign.
 *
 *  2. A minor's registration requires guardian consent. Age group is asked
 *     explicitly, and a supplied DOB is cross-checked against it, so neither
 *     field alone can slip a child through unconsented.
 *
 * Restricted fields (`medical_notes`, `allergies`, `emergency_contact_*`) are in
 * this allowlist because the registrant supplies them. data-model §10.1
 * restricts who may READ them afterwards, which is a different question and is
 * enforced by the Directus policy.
 */
import { z } from 'zod'
import { dateSchema, emailSchema, optionalNote, phoneSchema } from './common'

const AGE_GROUPS = ['adult', 'youth', 'teen', 'child', 'unknown'] as const

/** Age groups that cannot register without a guardian (data-model §3.2). */
export const MINOR_AGE_GROUPS = ['child', 'teen'] as const

export const registrationFormSchema = z
  .object({
    event: z.string().trim().min(1, 'An event is required').max(64),
    registrant_first_name: z.string().trim().min(1, 'First name is required').max(120),
    registrant_last_name: z.string().trim().min(1, 'Last name is required').max(120),
    email: emailSchema,
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
        message: 'Expected a Nigerian mobile number',
      })
      .optional(),
    date_of_birth: dateSchema
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    age_group: z.enum(AGE_GROUPS).default('unknown'),
    branch: z.string().trim().max(36).optional(),

    guardian_name: z.string().trim().max(200).optional(),
    guardian_phone: z
      .string()
      .trim()
      .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
        message: 'Expected a Nigerian mobile number',
      })
      .optional(),
    guardian_email: z
      .string()
      .trim()
      .refine((value) => value === '' || emailSchema.safeParse(value).success, {
        message: 'Expected an email address',
      })
      .optional(),
    guardian_consent: z.boolean().default(false),

    medical_notes: optionalNote(),
    allergies: optionalNote(),
    emergency_contact_name: z.string().trim().max(200).optional(),
    emergency_contact_phone: z
      .string()
      .trim()
      .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
        message: 'Expected a Nigerian mobile number',
      })
      .optional(),
  })
  .superRefine((form, ctx) => {
    const isMinorByGroup = (MINOR_AGE_GROUPS as readonly string[]).includes(
      form.age_group,
    )
    const isMinorByDate = isMinorByAge(form.date_of_birth)

    // A declared child age group plus an adult DOB is a contradiction, and a
    // contradiction here decides whether consent was collected. Refuse it
    // rather than guess which of the two the registrant meant.
    if (isMinorByGroup && form.date_of_birth && !isMinorByDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['age_group'],
        message: 'The stated age group does not match the date of birth',
      })
    }

    if (isMinorByGroup || isMinorByDate) {
      if (!form.guardian_consent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['guardian_consent'],
          message: 'A guardian must consent to the registration of a minor',
        })
      }
      if (!form.guardian_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['guardian_name'],
          message: 'A guardian name is required to register a minor',
        })
      }
      if (!form.guardian_phone && !form.guardian_email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['guardian_phone'],
          message: 'A guardian phone number or email address is required',
        })
      }
    }

    // Medical and emergency details are the registrant's own child. Without a
    // stated age group they cannot be attributed to anyone, so they are only
    // accepted alongside an age group.
    const hasChildDetail =
      Boolean(form.medical_notes) ||
      Boolean(form.allergies) ||
      Boolean(form.emergency_contact_name) ||
      Boolean(form.emergency_contact_phone)
    if (hasChildDetail && form.age_group === 'unknown') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['age_group'],
        message: 'State the age group when giving medical or emergency details',
      })
    }
  })

export type RegistrationForm = z.infer<typeof registrationFormSchema>
export type RegistrationFormInput = z.input<typeof registrationFormSchema>

function isMinorByAge(dateOfBirth: string | undefined): boolean {
  if (!dateOfBirth) return false
  const born = Date.parse(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(born)) return false
  const eighteen = new Date(born)
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18)
  return Date.now() < eighteen.getTime()
}

/**
 * The exact field set the public form may write. Enforced by
 * `toRegistrationPayload` below, and asserted by a unit test so the two cannot
 * drift apart.
 */
export const PUBLIC_REGISTRATION_FIELDS = [
  'event',
  'registrant_first_name',
  'registrant_last_name',
  'email',
  'phone',
  'date_of_birth',
  'age_group',
  'branch',
  'guardian_name',
  'guardian_phone',
  'guardian_email',
  'guardian_consent',
  'medical_notes',
  'allergies',
  'emergency_contact_name',
  'emergency_contact_phone',
] as const

export type PublicRegistrationField = (typeof PUBLIC_REGISTRATION_FIELDS)[number]

/**
 * Project a validated form onto the allowlist and stamp the fields the Flow
 * would otherwise assign. `source` is set to `public_form` here rather than
 * accepted from the client, so a public submission cannot masquerade as a
 * staff-created walk-in (PRD US-5).
 */
export function toRegistrationPayload(form: RegistrationForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source: 'public_form',
    consent_signed_at: form.guardian_consent ? new Date().toISOString() : null,
  }
  for (const field of PUBLIC_REGISTRATION_FIELDS) {
    payload[field] = form[field] ?? null
  }
  return payload
}
