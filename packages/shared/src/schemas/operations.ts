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

const LEAVE_YEAR_MIN = 2000
const LEAVE_YEAR_MAX = 2100

/**
 * Annual allowance (AFC-854 Time Off phase 1). One row per person per
 * year; used/remaining compute against leave_requests in phase 2.
 */
export const leaveBalanceFormSchema = z.object({
  person: z.string().trim().min(1, 'Choose who the allowance is for').max(36),
  year: z.coerce.number().int().min(LEAVE_YEAR_MIN).max(LEAVE_YEAR_MAX),
  allowance_days: z.coerce.number().int().min(0, 'Allowance cannot be negative'),
})

export type LeaveBalanceForm = z.infer<typeof leaveBalanceFormSchema>

export const leaveBalancePatchSchema = z.object({
  allowance_days: z.coerce.number().int().min(0, 'Allowance cannot be negative'),
})

export type LeaveBalancePatch = z.infer<typeof leaveBalancePatchSchema>
export const SESSION_ACTIVITY_TYPES = [
  'music',
  'prayer',
  'announcement',
  'talk',
  'bible_reading',
  'offering',
  'testimony',
  'drama',
  'communion',
  'welcome',
  'closing',
  'other',
] as const

/**
 * Programme item (AFC-826). Position orders items within a session;
 * duration is advisory (the order of service is not a timesheet).
 */
export const sessionActivityFormSchema = z.object({
  activity_type: z.enum(SESSION_ACTIVITY_TYPES),
  title: z.string().trim().min(1, 'Name the item').max(200),
  position: z.coerce.number().int().min(0).default(0),
  duration_minutes: z.coerce.number().int().min(0).max(1440).optional(),
  notes: optionalText(2000),
})

export type SessionActivityForm = z.infer<typeof sessionActivityFormSchema>

export const sessionActivityPatchSchema = sessionActivityFormSchema.partial()

export type SessionActivityPatch = z.infer<typeof sessionActivityPatchSchema>
export const OUTREACH_LOCATION_CATEGORIES = [
  'primary_school',
  'secondary_school',
  'prison',
  'skills_centre',
  'hospital',
  'other',
] as const

export const OUTREACH_LOCATION_OWNERSHIP = ['private', 'public'] as const

/**
 * AVS mission field (AFC-841). Branch/zone stamp server-side from the
 * caller's scope (0044 choice-8); contact + visiting days are free text.
 */
export const outreachLocationFormSchema = z.object({
  branch: optionalText(36),
  name: z.string().trim().min(1, 'Name the location').max(200),
  category: z.enum(OUTREACH_LOCATION_CATEGORIES),
  address: optionalText(1000),
  ownership: z.enum(OUTREACH_LOCATION_OWNERSHIP).default('private'),
  contact_name: optionalText(200),
  contact_phone: optionalText(40),
  visiting_days: optionalText(200),
  notes: optionalText(2000),
})

export type OutreachLocationForm = z.infer<typeof outreachLocationFormSchema>

export const outreachLocationPatchSchema = outreachLocationFormSchema.partial()

export type OutreachLocationPatch = z.infer<typeof outreachLocationPatchSchema>

export const outreachSecretaryFormSchema = z.object({
  person: z.string().trim().min(1, 'Choose the secretary').max(36),
})

export type OutreachSecretaryForm = z.infer<typeof outreachSecretaryFormSchema>
export const LEAVE_TYPES = [
  'annual',
  'sick',
  'maternity',
  'compassionate',
  'unpaid',
  'other',
] as const

export const LEAVE_STATUSES = ['pending', 'approved', 'declined', 'cancelled'] as const

/**
 * Leave request (AFC-842). Days count start..end inclusive and are stamped
 * by the route, never trusted from the client.
 */
export const leaveRequestFormSchema = z.object({
  branch: optionalText(36),
  person: z.string().trim().min(1, 'Choose who the leave is for').max(36),
  start_date: dateSchema,
  end_date: dateSchema,
  leave_type: z.enum(LEAVE_TYPES).default('annual'),
  reason: optionalText(2000),
})

export type LeaveRequestForm = z.infer<typeof leaveRequestFormSchema>

export const leaveRequestPatchSchema = z.object({
  leave_type: z.enum(LEAVE_TYPES).optional(),
  reason: optionalText(2000),
})

export type LeaveRequestPatch = z.infer<typeof leaveRequestPatchSchema>

export const leaveDecisionSchema = z.object({
  status: z.enum(['approved', 'declined', 'cancelled']),
})

export type LeaveDecision = z.infer<typeof leaveDecisionSchema>
export const SPEAKER_STATUSES = [
  'invited',
  'pending',
  'booked',
  'confirmed',
  'declined',
] as const

/**
 * Speaker booking (AFC-843). Directory person or typed external name —
 * exactly one, enforced here to mirror the 0053 person-or-name CHECK so
 * the error points at the form instead of arriving from Postgres.
 */
export const speakerFormSchema = z
  .object({
    person: z.string().trim().max(36).optional(),
    external_name: z.string().trim().max(200).optional(),
    status: z.enum(SPEAKER_STATUSES).default('pending'),
    special_requests: optionalText(2000),
    bio: optionalText(2000),
  })
  .refine((form) => Boolean(form.person) !== Boolean(form.external_name?.trim()), {
    message: 'Choose a directory person or type an external name — not both',
    path: ['person'],
  })

export type SpeakerForm = z.infer<typeof speakerFormSchema>

export const speakerPatchSchema = z.object({
  status: z.enum(SPEAKER_STATUSES).optional(),
  special_requests: optionalText(2000),
  bio: optionalText(2000),
})

export type SpeakerPatch = z.infer<typeof speakerPatchSchema>

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

/**
 * Welfare case category (data-model §6.1 + live-portal union, AFC-472).
 * The spec set admits food/housing; the live portal only offers the subset
 * it renders. Both validate so existing Directus rows keep parsing; new rows
 * use the spec values.
 */
const WELFARE_CATEGORIES = [
  'medical',
  'financial',
  'food',
  'housing',
  'bereavement',
  'education',
  'other',
] as const

export const welfareCaseFormSchema = z.object({
  case_ref: z.string().trim().min(1, 'A case reference is required').max(64),
  branch: optionalText(36),
  person: optionalText(36),
  category: z.enum(WELFARE_CATEGORIES).default('other'),
  priority: z.enum(['low', 'medium', 'normal', 'high', 'urgent']).default('normal'),
  status: z
    .enum(['open', 'in_progress', 'pending_approval', 'resolved', 'closed'])
    .default('open'),
  confidentiality: z.enum(['branch', 'area']).default('branch'),
  title: optionalNote(),
  amount_requested: moneySchema,
  amount_assisted: moneySchema,
  assigned_to: optionalText(36),
  description: optionalNote(),
  outcome_notes: optionalNote(),
})

export type WelfareCaseForm = z.infer<typeof welfareCaseFormSchema>

/**
 * Freeform case note (AFC-472). Written to welfare_case_events as
 * event_type `note`: `detail` is the short timeline summary, `body` the
 * long freeform text. Either may be sent; at least one is required so an
 * empty timeline row is never stored.
 */
export const welfareNoteFormSchema = z
  .object({
    detail: optionalNote(),
    body: optionalNote(),
  })
  .refine((value) => (value.detail ?? '') !== '' || (value.body ?? '') !== '', {
    message: 'Write a summary or a note',
    path: ['detail'],
  })

export type WelfareNoteForm = z.infer<typeof welfareNoteFormSchema>

const CONTRIBUTION_TYPES = ['cash', 'goods', 'service'] as const
const CONTRIBUTION_STATUSES = ['proposed', 'pending', 'approved', 'disbursed'] as const

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
