/**
 * Guided New Family wizard (AFC-590, parent AFC-460).
 *
 * One staff-guided submit creates a household plus its members plus the
 * channel consent records. The roles extend the household member model --
 * they are stored on `people.household_role` (migration 0026), not in a
 * parallel role system: `households.household_head` still names the head
 * row, and `household_role` names each member's place in the family.
 *
 * Consent wiring (Slice 4 model, data-model-v4 §4.7): a checked SMS or
 * WhatsApp box writes exactly one `consent_records` row with basis
 * `explicit_opt_in` for an adult and `guardian` for a minor (the head
 * consents on the minor's behalf at intake); an unchecked box writes
 * nothing. There are no parallel consent flags on the person row.
 *
 * Phone/email shapes reuse the shared schemas (phoneSchema + email), the
 * same pair the staff person form validates against.
 */
import { z } from 'zod'
import { dateSchema, emailSchema, optionalNote, phoneSchema, uuidSchema } from './common'

/** Household member roles for the wizard. `households.household_head`
 *  still carries the head link; this names every row's place. */
export const householdRoleSchema = z.enum([
  'head_of_household',
  'spouse',
  'child',
  'relative',
])
export type HouseholdRole = z.infer<typeof householdRoleSchema>

export const HOUSEHOLD_ROLES: HouseholdRole[] = [
  'head_of_household',
  'spouse',
  'child',
  'relative',
]

/** Wizard genders are M/F only (issue adaptation of the sample). */
export const householdWizardGenderSchema = z.enum(['male', 'female'])

const wizardPhoneSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
    message: 'Expected a Nigerian mobile number',
  })
  .optional()

const wizardEmailSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || emailSchema.safeParse(value).success, {
    message: 'Expected an email address',
  })
  .optional()

export const householdWizardMemberSchema = z.object({
  role: householdRoleSchema,
  first_name: z.string().trim().min(1, 'First name is required').max(120),
  last_name: z.string().trim().min(1, 'Last name is required').max(120),
  gender: householdWizardGenderSchema,
  date_of_birth: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  phone: wizardPhoneSchema,
  email: wizardEmailSchema,
  /** Checked = write one sms consent record; unchecked = no record. */
  consent_sms: z.boolean().default(false),
  /** Checked = write one whatsapp consent record; unchecked = no record. */
  consent_whatsapp: z.boolean().default(false),
})

export type HouseholdWizardMember = z.infer<typeof householdWizardMemberSchema>
export type HouseholdWizardMemberInput = z.input<typeof householdWizardMemberSchema>

/**
 * At most twenty members per submit: a family wizard is not a bulk
 * importer, and an unbounded array turns one staff submit into an
 * unbounded write fan-out.
 */
const MAX_WIZARD_MEMBERS = 20

export const householdWizardSchema = z
  .object({
    /** Optional; the server defaults to the caller's branch when absent. */
    branch: uuidSchema.optional(),
    /** Optional; the server defaults to "<head last name> family". */
    name: z.string().trim().max(255).optional(),
    address: optionalNote(),
    members: z
      .array(householdWizardMemberSchema)
      .min(1, 'Add at least one person')
      .max(MAX_WIZARD_MEMBERS, 'Split larger families across two submits'),
  })
  .superRefine((value, context) => {
    const heads = value.members.filter((member) => member.role === 'head_of_household')
    if (heads.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members'],
        message: 'Mark one person as head of household',
      })
    } else if (heads.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members'],
        message: 'Only one person can be head of household',
      })
    }
  })

export type HouseholdWizard = z.infer<typeof householdWizardSchema>
export type HouseholdWizardInput = z.input<typeof householdWizardSchema>
