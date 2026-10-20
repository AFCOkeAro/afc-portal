/**
 * Households.
 *
 * A household is the family unit behind `people.household` (data-model §2.5,
 * expanded in data-model-expansion §4.1 with `household_head`, `zone`,
 * `wedding_date`, `status` and the geo pin). The staff form covers the fields a
 * branch admin can type in one sitting; `zone` is Flow-maintained from
 * `branch` and `status` defaults to `active` server-side, so neither is a form
 * field. The geo/map-pin capture is deferred (address text only).
 *
 * `name` is required on the form even though the column is nullable: existing
 * rows predate the form, but a staff member creating a household without a
 * name produces an unfindable row in the list.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText, phoneSchema, uuidSchema } from './common'

export const householdFormSchema = z.object({
  name: z.string().trim().min(1, 'Name the household').max(255),
  branch: optionalText(36),
  address: optionalNote(),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || phoneSchema.safeParse(value).success, {
      message: 'Expected a Nigerian mobile number',
    })
    .optional(),
  wedding_date: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  household_head: uuidSchema.optional(),
})

export type HouseholdForm = z.infer<typeof householdFormSchema>
export type HouseholdFormInput = z.input<typeof householdFormSchema>

/** PATCH accepts any subset of the form; empty objects are rejected. */
export const householdPatchSchema = householdFormSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })
export type HouseholdPatch = z.infer<typeof householdPatchSchema>

/**
 * Link a person into a household (`people.household` M2O, data-model §2.3).
 * The household id comes from the route; the body names exactly one person.
 * Unlink uses the same shape and clears the field server-side.
 */
export const householdMemberLinkSchema = z.object({
  person: uuidSchema,
})
export type HouseholdMemberLink = z.infer<typeof householdMemberLinkSchema>

/** Narrow a {@link HouseholdForm} to the keys that are actually writable. */
export function toHouseholdPayload(form: HouseholdForm): Record<string, unknown> {
  return {
    name: form.name,
    branch: form.branch ?? null,
    address: form.address ?? null,
    phone: form.phone ?? null,
    wedding_date: form.wedding_date ?? null,
    household_head: form.household_head ?? null,
    status: 'active',
  }
}
