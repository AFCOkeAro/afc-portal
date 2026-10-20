/**
 * Attendance sex/category split (AFC-468, data-model-expansion §3).
 *
 * The wire types for `service_type_definitions` and `attendance_counts`, plus
 * the capture/report contracts the routes and the CSV share. Field names are
 * the Directus snake_case names, matching the convention in `types.ts`.
 *
 * Why this file exists separately from `operations.ts`: the headcount form
 * there validates the legacy AFC-147 capture (men/women/children + total),
 * which stays readable for back-compat. The split capture is a different form
 * over a different table, reviewed here rather than merged into the volunteer
 * phone form.
 */
import { z } from 'zod'
import { dateSchema, optionalText } from './common'

/** The ten categories from §3.3. Order here is display order, not authority. */
export const ATTENDANCE_CATEGORIES = [
  'children',
  'teens',
  'adults',
  'youth',
  'teachers',
  'ministers',
  'altar_workers',
  'avs',
  'visitors',
  'other',
] as const

export type AttendanceCategory = (typeof ATTENDANCE_CATEGORIES)[number]

export const ATTENDANCE_SEXES = ['male', 'female', 'unspecified'] as const

export type AttendanceSex = (typeof ATTENDANCE_SEXES)[number]

/** The eleven service-type keys seeded by 20261020_0003 (§3.1). */
export const SERVICE_TYPE_KEYS = [
  'sunday_school',
  'elementary',
  'devotional',
  'youth_service',
  'revival_service',
  'sunday_service',
  'midweek',
  'event',
  'camp',
  'department',
  'special',
] as const

export type ServiceTypeKey = (typeof SERVICE_TYPE_KEYS)[number]

export interface ServiceTypeDefinition {
  id: string
  key: string
  label: string
  /** Ordered category keys the capture form renders for this service type. */
  categories: AttendanceCategory[]
  supports_sex_split: boolean
  requires_bsc: boolean
  status: 'active' | 'inactive'
}

export interface AttendanceCount {
  id: string
  session: string
  category: AttendanceCategory
  category_other_label: string | null
  sex: AttendanceSex
  count: number
  created_by: string | null
  created_at: string
}

export const serviceTypeDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  categories: z
    .array(z.enum(ATTENDANCE_CATEGORIES))
    .min(1, 'A service type must offer at least one category'),
  supports_sex_split: z.boolean().default(true),
  requires_bsc: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
})

export type ServiceTypeDefinitionForm = z.infer<typeof serviceTypeDefinitionSchema>

/**
 * One split row. `category_other_label` is required exactly when
 * category = other (mirrors the attendance_counts_other_needs_label CHECK),
 * so the error can point at the label input instead of arriving from Postgres.
 */
export const attendanceCountSchema = z
  .object({
    session: z.string().trim().min(1).max(64),
    category: z.enum(ATTENDANCE_CATEGORIES),
    category_other_label: optionalText(200),
    sex: z.enum(['male', 'female', 'unspecified']).default('unspecified'),
    count: z.coerce.number().int().min(0),
  })
  .refine(
    (row) =>
      row.category !== 'other' ||
      (typeof row.category_other_label === 'string' &&
        row.category_other_label.trim().length > 0),
    { message: 'Name the other category', path: ['category_other_label'] },
  )

export type AttendanceCountForm = z.infer<typeof attendanceCountSchema>

/**
 * A whole capture batch: one idempotency key plus one row per
 * (category, sex). The unique (session, category, sex) constraint turns a
 * replayed batch into upsert no-ops; the key turns a double-submitted session
 * into a refusal rather than a twin (suite 71 pins both).
 */
export const attendanceCaptureBatchSchema = z.object({
  session: z.string().trim().min(1).max(64),
  idempotency_key: z.string().trim().min(1).max(128),
  recorded_at: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'Expected an ISO 8601 timestamp',
    })
    .optional(),
  rows: z.array(attendanceCountSchema).min(1, 'Record at least one category'),
})

export type AttendanceCaptureBatch = z.infer<typeof attendanceCaptureBatchSchema>

export function batchTotal(batch: { rows: Array<{ count: number }> }): number {
  return batch.rows.reduce((sum, row) => sum + row.count, 0)
}

/**
 * Report query contract (US-A3). Grouping is branch or zone; the period is
 * either a preset bucket or an explicit custom range. The CSV route accepts
 * these same fields and streams the same filtered aggregate.
 */
export const attendanceReportQuerySchema = z.object({
  group_by: z.enum(['branch', 'zone']).default('branch'),
  session_type: z.enum(SERVICE_TYPE_KEYS).optional(),
  period: z
    .enum(['weekly', 'monthly', 'quarterly', 'yearly', 'custom'])
    .default('monthly'),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  compare_prior_year: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
})

export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>
