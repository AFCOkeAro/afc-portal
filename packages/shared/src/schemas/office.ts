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

/**
 * Marriage pipeline stages (AFC-674 scope A). Brother/sister language only --
 * the pipeline never names a groom or a bride. Order is the user flow:
 * branch introduction -> zonal pastor -> Area Overseer -> ... -> wedding ->
 * reported, with `halted` (reason required, from any stage) and
 * `transferred_out` (receiving branch required, sister out-of-area) as the
 * terminal closes. Forward order is enforced by the routes (phase C), not
 * by a CHECK -- the database owns only the closed vocabulary plus the
 * actor-independent closes (halt reason, transfer destination, rehearsal
 * lead time).
 */
export const MARRIAGE_CASE_STAGES = [
  'introduction',
  'zonal_review',
  'overseer_review',
  'proposal_male',
  'counselling_prayer',
  'parental_consent_brother',
  'propose',
  'sister_prayer',
  'proposal_female',
  'parental_consent_sister',
  'terms_signatures',
  'family_introduction',
  'date_fixed',
  'questionnaires_counselling',
  'lga_certificate',
  'engagement_schedule',
  'wedding_info',
  'music_selection',
  'ministers_mail',
  'attire_check',
  'announcements_calendar',
  'rehearsal',
  'wedding',
  'reported',
  'halted',
  'transferred_out',
] as const
export type MarriageCaseStage = (typeof MARRIAGE_CASE_STAGES)[number]

/** Vow wording choice. Defaults to B; the wording source is transcribed in phase B. */
export const MARRIAGE_VOW_DEFAULT = 'B' as const

export const MARRIAGE_CERTIFICATE_TYPES = ['lga', 'fg', 'church', 'other'] as const
export type MarriageCertificateType = (typeof MARRIAGE_CERTIFICATE_TYPES)[number]

export const MARRIAGE_CASE_EVENT_TYPES = [
  'created',
  'stage_changed',
  'halted',
  'transferred_out',
  'approved',
  'note',
] as const
export type MarriageCaseEventType = (typeof MARRIAGE_CASE_EVENT_TYPES)[number]

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

/**
 * Marriage pipeline case (AFC-674 scope A). The create form names the
 * brother (required anchor) and optionally the sister (nullable until she
 * is linked in-DB); scope resolves server-side. Dates, files, vow choice
 * and report columns are filled per stage by the routes, never all at once.
 */
export interface MarriageCase {
  id: string
  brother_person: string
  sister_person: string | null
  branch: string
  zone: string | null
  stage: MarriageCaseStage
  halt_reason: string | null
  transfer_to_branch: string | null
  wedding_date: string | null
  rehearsal_date: string | null
  engagement_date: string | null
  vow_type: string
  wedding_info_verified: boolean
  terms_signed: boolean
  officiating_minister: string | null
  bible_passage: string | null
  certificate_type: MarriageCertificateType | null
  notes: string | null
  created_by: string | null
}

export const marriageCaseFormSchema = z.object({
  brother_person: z.string().uuid('Choose the brother'),
  sister_person: z.string().uuid().optional(),
  branch: branchRef,
  wedding_date: dateSchema.optional(),
  rehearsal_date: dateSchema.optional(),
  engagement_date: dateSchema.optional(),
  vow_type: z
    .string()
    .trim()
    .min(1, 'Choose the vow wording')
    .default(MARRIAGE_VOW_DEFAULT),
  notes: optionalNote(),
})
export type MarriageCaseForm = z.infer<typeof marriageCaseFormSchema>

/**
 * Stage transition (phase C routes). `halted` requires a reason;
 * `transferred_out` requires the receiving branch; the wedding-info
 * verify checkbox must be ticked before leaving `wedding_info`.
 * Forward order itself is a route rule with the contract suite.
 */
export const marriageCaseTransitionSchema = z
  .object({
    to_stage: z.enum(MARRIAGE_CASE_STAGES),
    halt_reason: optionalNote(),
    transfer_to_branch: optionalText(36),
    wedding_info_verified: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to_stage === 'halted' && !v.halt_reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['halt_reason'],
        message: 'Give the reason for halting',
      })
    }
    if (v.to_stage === 'transferred_out' && !v.transfer_to_branch) {
      ctx.addIssue({
        code: 'custom',
        path: ['transfer_to_branch'],
        message: 'Name the receiving branch',
      })
    }
  })
export type MarriageCaseTransition = z.infer<typeof marriageCaseTransitionSchema>

/**
 * Marriage workflow engine (AFC-678 phase C). The DB owns the closed stage
 * vocabulary (migration 0035); forward order lives here and in the routes.
 * `MARRIAGE_FLOW_STAGES` is the 24 user-flow stages in pipeline order --
 * `halted` and `transferred_out` are terminal closes reachable from any
 * stage, never forward steps. `MARRIAGE_FLOW_INDEX` is the order lookup
 * the transition route enforces (to-index must exceed from-index).
 */
export const MARRIAGE_FLOW_STAGES = MARRIAGE_CASE_STAGES.filter(
  (s): s is Exclude<MarriageCaseStage, 'halted' | 'transferred_out'> =>
    s !== 'halted' && s !== 'transferred_out',
)
export const MARRIAGE_FLOW_INDEX: Record<string, number> = Object.fromEntries(
  MARRIAGE_FLOW_STAGES.map((s, i) => [s, i]),
)

/**
 * Per-couple task template (AFC-678). One task per flow stage, generated at
 * case creation against the existing `tasks` table (related_type
 * `marriage_case`, related_id the case id). Titles use brother/sister
 * language only. `dueOffsetDays` counts from case creation (7 days per
 * stage step); the route re-anchors to the wedding date where one is set.
 * `stageGate` is the stage the task unblocks -- completing tasks never
 * moves the stage by itself; the transition route owns the gate.
 */
export interface MarriageStageTask {
  stageGate: string
  title: string
  dueOffsetDays: number
  priority: (typeof TASK_PRIORITIES)[number]
}

export const MARRIAGE_CASE_TASK_TEMPLATE: readonly MarriageStageTask[] = [
  {
    stageGate: 'introduction',
    title: 'Record branch introduction for the brother and sister',
    dueOffsetDays: 0,
    priority: 'normal',
  },
  {
    stageGate: 'zonal_review',
    title: 'Zonal pastor review of the couple',
    dueOffsetDays: 7,
    priority: 'high',
  },
  {
    stageGate: 'overseer_review',
    title: 'Area Overseer review of the couple',
    dueOffsetDays: 14,
    priority: 'high',
  },
  {
    stageGate: 'proposal_male',
    title: "Record the brother's proposal record",
    dueOffsetDays: 21,
    priority: 'normal',
  },
  {
    stageGate: 'counselling_prayer',
    title: 'Counselling and prayer session with the brother',
    dueOffsetDays: 28,
    priority: 'normal',
  },
  {
    stageGate: 'parental_consent_brother',
    title: "Collect the brother's parental consent letter",
    dueOffsetDays: 35,
    priority: 'normal',
  },
  {
    stageGate: 'propose',
    title: 'Record the proposal to the sister',
    dueOffsetDays: 42,
    priority: 'normal',
  },
  {
    stageGate: 'sister_prayer',
    title: 'Prayer session with the sister',
    dueOffsetDays: 49,
    priority: 'normal',
  },
  {
    stageGate: 'proposal_female',
    title: "Record the sister's proposal record",
    dueOffsetDays: 56,
    priority: 'normal',
  },
  {
    stageGate: 'parental_consent_sister',
    title: "Collect the sister's parental consent letter",
    dueOffsetDays: 63,
    priority: 'normal',
  },
  {
    stageGate: 'terms_signatures',
    title: 'Collect terms signatures and passports',
    dueOffsetDays: 70,
    priority: 'normal',
  },
  {
    stageGate: 'family_introduction',
    title: 'Family introduction and bridal list',
    dueOffsetDays: 77,
    priority: 'normal',
  },
  {
    stageGate: 'date_fixed',
    title: 'Fix and record the wedding date',
    dueOffsetDays: 84,
    priority: 'high',
  },
  {
    stageGate: 'questionnaires_counselling',
    title: 'Pre-marital questionnaires and counselling series',
    dueOffsetDays: 91,
    priority: 'normal',
  },
  {
    stageGate: 'lga_certificate',
    title: 'Collect the LGA/FG certificate',
    dueOffsetDays: 98,
    priority: 'normal',
  },
  {
    stageGate: 'engagement_schedule',
    title: 'Agree the engagement programme schedule',
    dueOffsetDays: 105,
    priority: 'normal',
  },
  {
    stageGate: 'wedding_info',
    title: 'Verify the wedding information form',
    dueOffsetDays: 112,
    priority: 'high',
  },
  {
    stageGate: 'music_selection',
    title: 'Music selection with the Music Director',
    dueOffsetDays: 119,
    priority: 'normal',
  },
  {
    stageGate: 'ministers_mail',
    title: 'Mail the ministers and announcements',
    dueOffsetDays: 126,
    priority: 'normal',
  },
  {
    stageGate: 'attire_check',
    title: 'Attire check before announcements',
    dueOffsetDays: 133,
    priority: 'high',
  },
  {
    stageGate: 'announcements_calendar',
    title: 'Three-Sunday announcements and calendar entry',
    dueOffsetDays: 140,
    priority: 'normal',
  },
  {
    stageGate: 'rehearsal',
    title: 'Rehearsal at least 3 days before the wedding',
    dueOffsetDays: 147,
    priority: 'high',
  },
  {
    stageGate: 'wedding',
    title: 'Wedding service',
    dueOffsetDays: 154,
    priority: 'urgent',
  },
  {
    stageGate: 'reported',
    title: 'Report the conducted marriage',
    dueOffsetDays: 161,
    priority: 'normal',
  },
]

/**
 * Approval gates (AFC-678). `zonal` signs off `zonal_review` (zonal pastor:
 * zone_admin and above); `overseer` signs off `overseer_review` (Area
 * Overseer: area_admin and above). Each approval writes a
 * marriage_case_events `approved` row; it never moves the stage -- the
 * transition route owns forward movement.
 */
export const MARRIAGE_APPROVAL_GATES = ['zonal', 'overseer'] as const
export type MarriageApprovalGate = (typeof MARRIAGE_APPROVAL_GATES)[number]

export const MARRIAGE_APPROVAL_STAGE: Record<MarriageApprovalGate, string> = {
  zonal: 'zonal_review',
  overseer: 'overseer_review',
}

export const marriageCaseApprovalSchema = z.object({
  gate: z.enum(MARRIAGE_APPROVAL_GATES),
  detail: optionalNote(),
})
export type MarriageCaseApproval = z.infer<typeof marriageCaseApprovalSchema>

/**
 * Transfer-out letter flow (AFC-678). The sister out-of-area closes the
 * file (stage `transferred_out` + receiving branch required by CHECK);
 * the sister link-in-DB path keeps the case open. The letter itself is a
 * route artefact recorded as the `transferred_out` event detail.
 */
export const marriageCaseTransferSchema = z.object({
  transfer_to_branch: z.string().uuid('Name the receiving branch'),
  letter_note: optionalNote(),
})
export type MarriageCaseTransfer = z.infer<typeof marriageCaseTransferSchema>

export const marriageCaseLinkSisterSchema = z.object({
  sister_person: z.string().uuid('Choose the sister'),
})
export type MarriageCaseLinkSister = z.infer<typeof marriageCaseLinkSisterSchema>

/**
 * Phase-D notifications (AFC-679). The Music Director is notified on the
 * portal (a tasks row the director sees at sign-in) once the case reaches
 * `wedding_info`; ministers are mailed ahead once the case reaches
 * `ministers_mail`. Both floors are route rules (the DB cannot know the
 * actor); the route re-checks them against MARRIAGE_FLOW_INDEX.
 */
export const MARRIAGE_NOTIFY_CHANNELS = ['music_director', 'ministers'] as const
export type MarriageNotifyChannel = (typeof MARRIAGE_NOTIFY_CHANNELS)[number]

export const MARRIAGE_NOTIFY_STAGE_FLOOR: Record<MarriageNotifyChannel, string> = {
  music_director: 'wedding_info',
  ministers: 'ministers_mail',
}

export const marriageCaseNotifySchema = z.object({
  channel: z.enum(MARRIAGE_NOTIFY_CHANNELS),
  note: optionalNote(),
})
export type MarriageCaseNotify = z.infer<typeof marriageCaseNotifySchema>

/**
 * Phase-D schedule (AFC-679). Sets the wedding and rehearsal dates without
 * moving the stage. The 3-day rehearsal lead is re-checked here with the
 * {code, fields} failure shape; the migration-0035 CHECK is the backstop a
 * crafted request cannot skip.
 */
export const marriageCaseScheduleSchema = z
  .object({
    wedding_date: dateSchema.optional(),
    rehearsal_date: dateSchema.optional(),
  })
  .refine((v) => v.wedding_date !== undefined || v.rehearsal_date !== undefined, {
    message: 'Set the wedding date, the rehearsal date, or both',
    path: ['wedding_date'],
  })
export type MarriageCaseSchedule = z.infer<typeof marriageCaseScheduleSchema>

/**
 * Phase-D announcements + calendar (AFC-679). Runs at
 * `announcements_calendar` (the attire-check gate passes first: the
 * transition route refuses any skip into this stage). Writes three Sunday
 * announcement rows (defaults: the three Sundays before the wedding date)
 * plus a wedding event row so the calendar feed carries the date. The
 * caller may name extra branches (both families' sides); every named
 * branch must sit inside the caller scope.
 */
export const marriageCaseAnnounceSchema = z.object({
  branches: z.array(z.string().uuid()).max(8).optional(),
  publish_sundays: z.array(dateSchema).max(3).optional(),
})
export type MarriageCaseAnnounce = z.infer<typeof marriageCaseAnnounceSchema>

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
  item_type: z
    .enum([
      'service',
      'event',
      'programme',
      'celebration',
      'birthday',
      'anniversary',
      'task',
      'marriage',
    ])
    .optional(),
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
