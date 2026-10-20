/**
 * People.
 *
 * Consent fields are booleans that default to false rather than being optional.
 * A registrant who never ticks the box must produce `false` in the payload, not
 * `undefined` — an undefined boolean is how a consent record silently becomes
 * "not asked" instead of "no".
 *
 * `is_minor` is absent by design: it is derived from DOB by a Flow and must
 * never be hand-edited (data-model §2.3).
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText, phoneSchema } from './common'
import { personExtensionSchema } from './youth'

const GENDERS = ['male', 'female', 'unspecified'] as const

const MEMBERSHIP_STATUSES = [
  'member',
  'regular_attendee',
  'visitor',
  'youth',
  'child',
  'staff',
  'inactive',
] as const

export const personFormSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(120),
  last_name: z.string().trim().min(1, 'Last name is required').max(120),
  preferred_name: optionalText(120),
  other_names: optionalText(255),
  gender: z.enum(GENDERS).default('unspecified'),
  date_of_birth: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
      message: 'Expected a Nigerian mobile number',
    })
    .optional(),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'Expected an email address',
    })
    .optional(),
  address: optionalNote(),
  branch: optionalText(36),
  membership_status: z.enum(MEMBERSHIP_STATUSES).default('member'),
  member_since: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  guardian: optionalText(36),
  consent_data: z.boolean().default(false),
  consent_media: z.boolean().default(false),
  /**
   * §4.2 additions (AFC-476, data-model-expansion §4.2). All optional, so
   * rows written before the youth slice still parse. `status` is absent by
   * design: the (active, archived) closure is a retention control (suite 63)
   * and the expansion is withheld pending a CTO decision.
   */
  marital_status: personExtensionSchema.shape.marital_status,
  marriage_date: personExtensionSchema.shape.marriage_date,
  occupation: personExtensionSchema.shape.occupation,
  employment_status: personExtensionSchema.shape.employment_status,
  education_level: personExtensionSchema.shape.education_level,
  institution: personExtensionSchema.shape.institution,
  is_entrepreneur: z.boolean().default(false),
  professional_status: personExtensionSchema.shape.professional_status,
  is_youth: personExtensionSchema.shape.is_youth,
  locality: personExtensionSchema.shape.locality,
  sub_location: personExtensionSchema.shape.sub_location,
  person_type: personExtensionSchema.shape.person_type,
})
export type PersonForm = z.infer<typeof personFormSchema>
export type PersonFormInput = z.input<typeof personFormSchema>

/**
 * A minor cannot be stored without a guardian (PRD §7.1 safeguarding and
 * consent; data-model §2.3 `guardian` is for minors).
 *
 * `is_minor` is server-derived, so the check cannot live inside the object
 * schema — it needs the DOB against today's date. Keeping it here means it is
 * applied identically on the staff form and the server route rather than
 * trusted to whichever one was written first.
 */
export function personFormNeedsGuardian(
  form: Pick<PersonForm, 'date_of_birth' | 'guardian'>,
  today: Date = new Date(),
): boolean {
  if (!form.date_of_birth) return false
  if (form.guardian) return false
  const born = Date.parse(`${form.date_of_birth}T00:00:00Z`)
  if (Number.isNaN(born)) return false
  return today.getTime() < addUtcYears(born, 18)
}

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000

function addUtcYears(ms: number, years: number): number {
  const date = new Date(ms)
  date.setUTCFullYear(date.getUTCFullYear() + years)
  return date.getTime()
}

/** Whole years between `date_of_birth` and `today`. Null when no DOB is known. */
export function ageInYears(
  dateOfBirth: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null
  const born = Date.parse(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(born)) return null
  return Math.floor((today.getTime() - born) / MS_PER_YEAR)
}

/** Narrow a {@link PersonForm} to the keys that are actually writable. */
export function toPersonPayload(form: PersonForm): Record<string, unknown> {
  return {
    first_name: form.first_name,
    last_name: form.last_name,
    preferred_name: form.preferred_name ?? null,
    other_names: form.other_names ?? null,
    gender: form.gender,
    date_of_birth: form.date_of_birth ?? null,
    phone: form.phone ?? null,
    email: form.email ?? null,
    address: form.address ?? null,
    branch: form.branch ?? null,
    membership_status: form.membership_status,
    member_since: form.member_since ?? null,
    guardian: form.guardian ?? null,
    consent_data: form.consent_data,
    consent_media: form.consent_media,
    consent_signed_at: form.consent_data ? new Date().toISOString() : null,
    marital_status: form.marital_status ?? null,
    marriage_date: form.marriage_date ?? null,
    occupation: form.occupation ?? null,
    employment_status: form.employment_status ?? null,
    education_level: form.education_level ?? null,
    institution: form.institution ?? null,
    is_entrepreneur: form.is_entrepreneur ?? false,
    professional_status: form.professional_status ?? null,
    is_youth: form.is_youth ?? null,
    locality: form.locality ?? null,
    sub_location: form.sub_location ?? null,
    person_type: form.person_type ?? null,
  }
}
