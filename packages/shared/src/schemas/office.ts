/**
 * Office bundle (AFC-477, data-model-expansion §§9.1–9.7, prd-expansion §10).
 *
 * Form schemas for transfers, marriage matters, minutes (+attendees),
 * tasks, announcements and event referrals, plus the calendar/search query
 * contracts. A form schema validates what the person typed, not the row:
 * scope (branch/zone) resolves server-side from the session, total/derived
 * columns are never sent, and audit rows are written by the route, never
 * by the client.
 */
import { z } from 'zod'
import {
  dateSchema,
  dateTimeSchema,
  listQuerySchema,
  optionalNote,
  optionalText,
  timeSchema,
} from './common'

export const TRANSFER_STATUSES = [
  'requested',
  'approved',
  'completed',
  'rejected',
] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const MARRIAGE_TYPES = ['banns', 'wedding', 'counselling', 'other'] as const
export type MarriageType = (typeof MARRIAGE_TYPES)[number]

export const MARRIAGE_STATUSES = ['open', 'in_progress', 'completed', 'closed'] as const
export type MarriageStatus = (typeof MARRIAGE_STATUSES)[number]

export const MINUTES_STATUSES = ['draft', 'final', 'published'] as const
export type MinutesStatus = (typeof MINUTES_STATUSES)[number]

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const ANNOUNCEMENT_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'cancelled',
] as const
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number]

export const REFERRAL_STATUSES = [
  'invited',
  'contacted',
  'registered',
  'attended',
  'declined',
] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export interface Transfer {
  id: string
  person: string
  from_branch: string
  to_branch: string
  zone: string | null
  reason: string | null
  request_date: string
  effective_date: string | null
  status: TransferStatus
  requested_by: string | null
  approved_by: string | null
  notes: string | null
}

export interface MarriageMatter {
  id: string
  person: string
  partner_person: string | null
  branch: string
  zone: string | null
  matter_type: MarriageType
  wedding_date: string | null
  status: MarriageStatus
  notes: string | null
  created_by: string | null
}

export interface OfficeMinute {
  id: string
  title: string
  meeting_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  body: string | null
  file: string | null
  status: MinutesStatus
  branch: string
  zone: string | null
  created_by: string | null
}

export interface MinutesAttendee {
  id: string
  minute: string
  person: string | null
  attendee_user: string | null
}

export interface OfficeTask {
  id: string
  title: string
  description: string | null
  assignee_user: string | null
  assignee_person: string | null
  branch: string
  zone: string | null
  due_date: string | null
  status: TaskStatus
  priority: TaskPriority
  related_type: string | null
  related_id: string | null
}

export interface Announcement {
  id: string
  title: string
  body: string | null
  publish_from: string | null
  publish_to: string | null
  channels: string[]
  audience: Record<string, unknown>
  status: AnnouncementStatus
  branch: string | null
  zone: string | null
  created_by: string | null
  approved_by: string | null
}

export interface EventReferral {
  id: string
  event: string
  inviter: string | null
  invitee_name: string
  invitee_person: string | null
  branch: string | null
  zone: string | null
  invite_date: string
  status: ReferralStatus
}

const branchRef = optionalText(36)

export const transferFormSchema = z
  .object({
    person: z.string().uuid('Choose the person transferring'),
    from_branch: z.string().uuid(),
    to_branch: z.string().uuid(),
    reason: optionalNote(),
    effective_date: dateSchema.optional(),
    notes: optionalNote(),
  })
  .refine((v) => v.from_branch !== v.to_branch, {
    message: 'The destination branch must differ from the origin branch',
    path: ['to_branch'],
  })
export type TransferForm = z.infer<typeof transferFormSchema>

export const transferStatusSchema = z.object({ status: z.enum(TRANSFER_STATUSES) })
export type TransferStatusChange = z.infer<typeof transferStatusSchema>

export const marriageFormSchema = z.object({
  person: z.string().uuid('Choose the person'),
  partner_person: z.string().uuid().optional(),
  branch: branchRef,
  matter_type: z.enum(MARRIAGE_TYPES).default('wedding'),
  wedding_date: dateSchema.optional(),
  notes: optionalNote(),
})
export type MarriageForm = z.infer<typeof marriageFormSchema>

export const minutesFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    meeting_date: dateSchema,
    start_time: timeSchema.optional(),
    end_time: timeSchema.optional(),
    location: optionalText(255),
    // Markdown body (AFC-670): the existing 4000-char cap stays the sane
    // maximum — a rendered minute with tables fits comfortably inside it,
    // and the column is unbounded text, so the form is the bound.
    body: optionalNote(),
    file: optionalText(36),
    branch: branchRef,
  })
  .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, {
    message: 'The end time must be after the start time',
    path: ['end_time'],
  })
export type MinutesForm = z.infer<typeof minutesFormSchema>

export const attendeeFormSchema = z
  .object({ person: optionalText(36), attendee_user: optionalText(36) })
  .refine((v) => v.person !== undefined || v.attendee_user !== undefined, {
    message: 'Link a person or a user',
    path: ['person'],
  })
export type AttendeeForm = z.infer<typeof attendeeFormSchema>

export const taskFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: optionalNote(),
    assignee_user: optionalText(36),
    assignee_person: optionalText(36),
    branch: branchRef,
    due_date: dateSchema.optional(),
    priority: z.enum(TASK_PRIORITIES).default('normal'),
    related_type: optionalText(40),
    related_id: optionalText(36),
  })
  .refine((v) => v.assignee_user !== undefined || v.assignee_person !== undefined, {
    message: 'Assign a user or a person',
    path: ['assignee_user'],
  })
export type TaskForm = z.infer<typeof taskFormSchema>

export const taskStatusSchema = z.object({ status: z.enum(TASK_STATUSES) })
export type TaskStatusChange = z.infer<typeof taskStatusSchema>

export const announcementFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    body: optionalNote(),
    publish_from: dateTimeSchema.optional(),
    publish_to: dateTimeSchema.optional(),
    channels: z.array(z.string().trim().min(1).max(40)).default([]),
    audience: z.record(z.unknown()).default({}),
    branch: branchRef,
  })
  .refine(
    (v) =>
      !v.publish_from ||
      !v.publish_to ||
      Date.parse(v.publish_to) >= Date.parse(v.publish_from),
    { message: 'The publish window must end after it starts', path: ['publish_to'] },
  )
export type AnnouncementForm = z.infer<typeof announcementFormSchema>

export const announcementStatusSchema = z.object({
  status: z.enum(ANNOUNCEMENT_STATUSES),
})
export type AnnouncementStatusChange = z.infer<typeof announcementStatusSchema>

export const referralFormSchema = z.object({
  event: z.string().uuid(),
  inviter: optionalText(36),
  invitee_name: z.string().trim().min(1, 'Name the invitee').max(200),
  invitee_person: optionalText(36),
  status: z.enum(REFERRAL_STATUSES).default('invited'),
})
export type ReferralForm = z.infer<typeof referralFormSchema>

/** CSV column orders (each export streams the same scoped query as its list). */
export const TRANSFER_CSV_COLUMNS = [
  'person',
  'from_branch',
  'to_branch',
  'status',
  'request_date',
  'effective_date',
] as const

export const TASK_CSV_COLUMNS = [
  'title',
  'assignee',
  'status',
  'priority',
  'due_date',
  'branch',
] as const

export const ANNOUNCEMENT_CSV_COLUMNS = [
  'title',
  'status',
  'publish_from',
  'publish_to',
  'branch',
] as const

/**
 * Calendar query contract (US-U3). Scope + type filters over the unified
 * feed; the feed helper owns the combination, the route owns the scope.
 */
export const calendarQuerySchema = listQuerySchema.extend({
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  item_type: z.enum(['service', 'event', 'programme', 'celebration']).optional(),
  scope_type: z.enum(['branch', 'zone', 'area']).optional(),
})
export type CalendarQuery = z.infer<typeof calendarQuerySchema>

/**
 * Cross-entity search contract. `q` is required (an empty query returns
 * nothing, never everything); the caller scope is fail-closed upstream.
 * Domains mirror the issue list: people, households, branches, BSCs,
 * events, tasks, minutes.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(120),
  domain: z
    .enum(['people', 'households', 'branches', 'bscs', 'events', 'tasks', 'minutes'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>
