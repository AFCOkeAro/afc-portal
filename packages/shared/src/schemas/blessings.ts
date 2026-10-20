/**
 * Blessings records (AFC-474, data-model-expansion §3.4, prd-expansion §3).
 *
 * One row per (service/program, blessing_type) with male/female counts;
 * total is GENERATED in Postgres (male+female, never sent by the client),
 * so no form schema carries it. `other_label` is required exactly when
 * blessing_type = other (mirrors the blessings_other_needs_label CHECK),
 * so the error points at the label input instead of arriving from Postgres.
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
  male_count: number
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
  male_count: z.coerce.number().int().min(0).default(0),
  female_count: z.coerce.number().int().min(0).default(0),
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

/** CSV column order (US-B2 AC2): branch, zone, service, date, type, male, female, total. */
export const BLESSING_CSV_COLUMNS = [
  'branch',
  'zone',
  'service',
  'date',
  'blessing_type',
  'male',
  'female',
  'total',
] as const
