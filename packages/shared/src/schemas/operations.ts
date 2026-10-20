/**
 * Attendance, visitors and welfare.
 *
 * Three collections, one file: none of them is big enough to deserve a module of
 * its own, and they are the three screens a volunteer uses on a phone, so they
 * are reviewed together.
 */
import { z } from 'zod'
import { dateSchema, moneySchema, optionalNote, optionalText } from './common'

const SESSION_TYPES = [
  'sunday_service',
  'midweek',
  'event',
  'camp',
  'department',
] as const

/**
 * Headcount capture (PRD US-7).
 *
 * The total is not a form field. It is computed from the three category counts
 * and written server-side, because a total typed by hand is a second number
 * that can disagree with the first three, and the dashboard and the monitoring
 * exporter both read the total.
 */
export const attendanceSessionFormSchema = z.object({
  branch: optionalText(36),
  session_date: dateSchema,
  session_type: z.enum(SESSION_TYPES).default('sunday_service'),
  session_name: z.string().trim().min(1, 'Name the session').max(200),
  service: optionalText(36),
  event: optionalText(36),
  headcount_men: z.coerce.number().int().min(0).default(0),
  headcount_women: z.coerce.number().int().min(0).default(0),
  headcount_children: z.coerce.number().int().min(0).default(0),
})

export type AttendanceSessionForm = z.infer<typeof attendanceSessionFormSchema>

export function headcountTotal(form: {
  headcount_men: number
  headcount_women: number
  headcount_children: number
}): number {
  return form.headcount_men + form.headcount_women + form.headcount_children
}

/**
 * Named check-in (PRD US-8). Either a person id or a typed name is enough; a
 * session can be counted without naming anybody.
 */
export const attendanceRecordFormSchema = z.object({
  session: z.string().trim().min(1).max(64),
  person: z.string().trim().max(36).optional(),
  attendee_name: z.string().trim().max(200).optional(),
  attendance_category: z.enum(['member', 'visitor', 'child', 'other']).optional(),
})

export type AttendanceRecordForm = z.infer<typeof attendanceRecordFormSchema>

const VISITOR_STATUSES = ['new', 'follow_up', 'converted', 'closed', 'declined'] as const

export const visitorFormSchema = z.object({
  branch: optionalText(36),
  visitor_first_name: z.string().trim().min(1, 'First name is required').max(120),
  visitor_last_name: z.string().trim().min(1, 'Last name is required').max(120),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'Expected an email address',
    })
    .optional(),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || /^(\+?234|0)[789][01]\d{8}$/.test(value), {
      message: 'Expected a Nigerian mobile number',
    })
    .optional(),
  visit_date: dateSchema,
  event: optionalText(36),
  age_group: z.enum(['adult', 'youth', 'teen', 'child', 'unknown']).default('unknown'),
  invited_by: optionalText(36),
  follow_up_owner: optionalText(36),
  next_follow_up_date: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  notes: optionalNote(),
  status: z.enum(VISITOR_STATUSES).default('new'),
})

export type VisitorForm = z.infer<typeof visitorFormSchema>

const WELFARE_CATEGORIES = [
  'medical',
  'financial',
  'bereavement',
  'education',
  'other',
] as const

export const welfareCaseFormSchema = z.object({
  case_ref: z.string().trim().min(1, 'A case reference is required').max(64),
  branch: optionalText(36),
  person: optionalText(36),
  category: z.enum(WELFARE_CATEGORIES).default('other'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).default('open'),
  amount_requested: moneySchema,
  amount_assisted: moneySchema,
  assigned_to: optionalText(36),
  description: optionalNote(),
  outcome_notes: optionalNote(),
})

export type WelfareCaseForm = z.infer<typeof welfareCaseFormSchema>

const CONTRIBUTION_TYPES = ['cash', 'goods', 'service'] as const
const CONTRIBUTION_STATUSES = ['pending', 'approved', 'disbursed'] as const

/**
 * A contribution record against a welfare case. `amount` is optional because
 * goods and services may have no cash value; a cash contribution is checked
 * again in the route, where the error can point at the amount input.
 */
export const welfareContributionFormSchema = z.object({
  contribution_type: z.enum(CONTRIBUTION_TYPES).default('cash'),
  amount: moneySchema.optional(),
  description: optionalNote(),
  contributor: optionalText(200),
  status: z.enum(CONTRIBUTION_STATUSES).default('pending'),
})

export type WelfareContributionForm = z.infer<typeof welfareContributionFormSchema>
