/**
 * Primitives shared by every form schema.
 *
 * A schema per form rather than one schema per collection: a form sends what
 * the person typed, which is not the row. `people` has eleven columns on the
 * page and forty in Directus; validating the row would make every form fail on
 * fields it never shows.
 */
import { z } from 'zod'

export const uuidSchema = z.string().uuid()

/** `YYYY-MM-DD`, the wire format for a Postgres `date`. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

/** ISO 8601 with an offset, the wire format for a `timestamptz`. */
export const dateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO 8601 timestamp')

/** Postgres `numeric(12,2)` arrives as a string; it is not a float. */
export const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Expected a decimal amount with at most two places')
  .or(z.literal(''))
  .transform((value) => (value === '' ? null : value))

/**
 * A trimmed string that is optional, and normalises `""` to `undefined`.
 * Forms submit empty inputs; Directus stores NULL. Without this, every optional
 * field would round-trip as an empty string instead of null.
 */
export const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value))

/** As `optionalText`, but the column is a `text` and has no length cap. */
export const optionalNote = () => optionalText(4000)

/** Lagos Nigerian mobile numbers, accepted with or without the country code. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^(\+?234|0)[789][01]\d{8}$/,
    'Expected a Nigerian mobile number, for example 08012345678',
  )

export const emailSchema = z.string().trim().email()

/**
 * Free-text search passed straight through to a Directus `search` query.
 * Bounded here so a URL cannot carry an unbounded query string into a filter.
 */
export const searchSchema = z.string().trim().max(120).optional()

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  search: searchSchema,
  sort: z.string().trim().max(80).optional(),
})
export type ListQuery = z.infer<typeof listQuerySchema>

/** The Directus list envelope. `meta.total` is what the UI paginates on. */
export interface ListResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    limit: number
  }
}

/**
 * Standard error body for every server route in this app, so a client can
 * branch on `error.code` instead of parsing prose.
 */
export interface ApiError {
  error: {
    code: string
    message: string
    /** Field-level detail, keyed by field path. Safe to show next to an input. */
    fields?: Record<string, string>
  }
}
