/**
 * Blessings records (AFC-474, data-model-expansion §3.4, prd-expansion §3;
 * single-count + individual mapping AFC-671).
 *
 * One row per (service/program, blessing_type) with a single `count`
 * (no male/female split — the user ask on AFC-460). `total_count` is still
 * GENERATED in Postgres (male+female, never sent by the client) and new
 * writes mirror male_count = count, female_count = 0, so total always
 * equals count. `male_count`/`female_count` are deprecated read-only
 * history: no form sends them, reports read `count`. `other_label` is
 * required exactly when blessing_type = other (mirrors the
 * blessings_other_needs_label CHECK), so the error points at the label
 * input instead of arriving from Postgres.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText } from './common'

/** The six blessing types from §3.4, in document order. */
export const BLESSING_TYPES = [
  'salvation',
  'sanctification',
  'baptism_holy_ghost',
  'reanointing',
  'healing',
  'other',
] as const

export type BlessingType = (typeof BLESSING_TYPES)[number]

export const BLESSING_EVENT_TYPES = ['created', 'updated', 'note'] as const

export type BlessingEventType = (typeof BLESSING_EVENT_TYPES)[number]

export interface Blessing {
  id: string
  blessing_type: BlessingType
  other_label: string | null
  /** Single count per type (AFC-671). New writes mirror male = count. */
  count: number
  /** Deprecated history (AFC-671): kept for existing rows, never written. */
  male_count: number
  /** Deprecated history (AFC-671): kept for existing rows, never written. */
  female_count: number
  /** GENERATED ALWAYS AS (male_count + female_count) STORED. Read, never sent. */
  total_count: number
  branch: string
  /** Denorm via branch (Flow-maintained). */
  zone: string | null
  bsc: string | null
  session: string | null
  event: string | null
  sunday_service: string | null
  service_date: string
  recorded_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Explicit blessing audit (AFC-474; welfare_case_events precedent). */
export interface BlessingEvent {
  id: string
  blessing: string
  event_type: BlessingEventType
  detail: string | null
  actor_user: string | null
  created_at: string
}

const blessingBaseSchema = z.object({
  blessing_type: z.enum(BLESSING_TYPES),
  other_label: optionalText(200),
  /** Single count per type (AFC-671, no male/female split). Optional so
   * legacy male/female bodies (imports) still validate; the route sums
   * them only when no count is sent. */
  count: z.coerce.number().int().min(0).optional(),
  /** Deprecated (AFC-671): accepted for import compat, never written. */
  male_count: z.coerce.number().int().min(0).default(0).optional(),
  /** Deprecated (AFC-671): accepted for import compat, never written. */
  female_count: z.coerce.number().int().min(0).default(0).optional(),
  branch: optionalText(36),
  zone: optionalText(36),
  bsc: optionalText(36),
  session: optionalText(36),
  event: optionalText(36),
  sunday_service: optionalText(36),
  service_date: dateSchema,
  notes: optionalNote(),
})

function needsOtherLabel(row: { blessing_type?: string; other_label?: string }): boolean {
  return (
    row.blessing_type !== 'other' ||
    (typeof row.other_label === 'string' && row.other_label.trim().length > 0)
  )
}

export const blessingFormSchema = blessingBaseSchema.refine(needsOtherLabel, {
  message: 'Name the other blessing',
  path: ['other_label'],
})

export type BlessingForm = z.infer<typeof blessingFormSchema>

export const blessingUpdateSchema = blessingBaseSchema
  .omit({ branch: true })
  .partial()
  .extend({ branch: optionalText(36) })
  .refine(needsOtherLabel, {
    message: 'Name the other blessing',
    path: ['other_label'],
  })

export type BlessingUpdate = z.infer<typeof blessingUpdateSchema>

/**
 * One-screen bulk entry (AFC-671 §A). One Save writes N rows in one
 * request: the six types at once with a single count each. Rows with
 * count 0 and no other_label are skipped (not stored as empty facts);
 * every written row is idempotent per type per program (the route
 * upserts on branch + service_date + type + label + program links).
 */
const blessingBulkRowSchema = z.object({
  blessing_type: z.enum(BLESSING_TYPES),
  other_label: optionalText(200),
  count: z.coerce.number().int().min(0).default(0),
})

export const blessingBulkFormSchema = z
  .object({
    branch: optionalText(36),
    zone: optionalText(36),
    bsc: optionalText(36),
    session: optionalText(36),
    event: optionalText(36),
    sunday_service: optionalText(36),
    service_date: dateSchema,
    notes: optionalNote(),
    rows: z.array(blessingBulkRowSchema).min(1).max(BLESSING_TYPES.length),
  })
  .superRefine((form, ctx) => {
    for (let index = 0; index < form.rows.length; index += 1) {
      const row = form.rows[index]
      if (!row) continue
      if (
        row.blessing_type === 'other' &&
        !(typeof row.other_label === 'string' && row.other_label.trim().length > 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Name the other blessing',
          path: ['rows', index, 'other_label'],
        })
      }
    }
    if (!form.rows.some((row) => Number(row.count ?? 0) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter at least one blessing count',
        path: ['rows'],
      })
    }
  })

export type BlessingBulkForm = z.infer<typeof blessingBulkFormSchema>

/** Individual blessing mapped to a DB person/user (AFC-671 §C). */
export interface BlessingRecipient {
  id: string
  /** Nullable: a recipient may stand alone with its own blessing_type. */
  blessing: string | null
  blessing_type: BlessingType
  other_label: string | null
  /** DB person (people FK RESTRICT). At least one of person/attendee_user. */
  person: string | null
  attendee_user: string | null
  branch: string
  zone: string | null
  bsc: string | null
  session: string | null
  event: string | null
  sunday_service: string | null
  service_date: string
  recorded_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

function needsRecipientPerson(row: {
  person?: string | null
  attendee_user?: string | null
}): boolean {
  return Boolean(
    (typeof row.person === 'string' && row.person.length > 0) ||
      (typeof row.attendee_user === 'string' && row.attendee_user.length > 0),
  )
}

const blessingRecipientBaseSchema = z.object({
  blessing: optionalText(36),
  blessing_type: z.enum(BLESSING_TYPES),
  other_label: optionalText(200),
  person: optionalText(36),
  attendee_user: optionalText(36),
  branch: optionalText(36),
  zone: optionalText(36),
  bsc: optionalText(36),
  session: optionalText(36),
  event: optionalText(36),
  sunday_service: optionalText(36),
  service_date: dateSchema,
  notes: optionalNote(),
})

export const blessingRecipientFormSchema = blessingRecipientBaseSchema
  .refine(needsOtherLabel, {
    message: 'Name the other blessing',
    path: ['other_label'],
  })
  .refine(needsRecipientPerson, {
    message: 'Choose a person for this blessing',
    path: ['person'],
  })

export type BlessingRecipientForm = z.infer<typeof blessingRecipientFormSchema>

export const blessingRecipientUpdateSchema = blessingRecipientBaseSchema
  .omit({ branch: true })
  .partial()
  .extend({ branch: optionalText(36) })
  .refine(needsOtherLabel, {
    message: 'Name the other blessing',
    path: ['other_label'],
  })

export type BlessingRecipientUpdate = z.infer<typeof blessingRecipientUpdateSchema>

/**
 * Report query contract (US-B2). Grouping is branch or zone; the period is
 * either a preset bucket or an explicit custom range. The CSV route accepts
 * these same fields and streams the same filtered aggregate, so the export
 * cannot drift from the list (attendance-split report precedent).
 */
export const blessingReportQuerySchema = z.object({
  group_by: z.enum(['branch', 'zone']).default('branch'),
  blessing_type: z.enum(BLESSING_TYPES).optional(),
  period: z
    .enum(['weekly', 'monthly', 'quarterly', 'yearly', 'custom'])
    .default('monthly'),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().trim().max(80).optional(),
})

export type BlessingReportQuery = z.infer<typeof blessingReportQuerySchema>

/** CSV column order (US-B2 AC2, AFC-671 single-count): branch, zone, service, date, type, count. */
export const BLESSING_CSV_COLUMNS = [
  'branch',
  'zone',
  'service',
  'date',
  'blessing_type',
  'count',
] as const
