/**
 * Youth profiles + celebrations (AFC-476, data-model-expansion §§6.1-6.2,
 * 4.2-4.4, prd-expansion §6 US-Y1/US-Y2/US-Y3).
 *
 * `youth_profiles` is a 1-1 child of `people` (person UNIQUE, CASCADE): the
 * youth directory is the same church DB, not a second store (US-Y1 AC2), so
 * the form takes a person link and never a name. `celebrations` carries the
 * birthday/anniversary/shout-out feed with a server-enforced
 * draft -> approved -> published -> archived lifecycle and a stored
 * `guardian_consent` flag the routes require for minors (register.post.ts
 * guardian precedent). Feed payloads never carry DOB or medical fields --
 * neither table has those columns, and the routes read an allowlist, so
 * there is nothing to strip.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText } from './common'

/** §6.1 education levels, in document order. */
export const YOUTH_EDUCATION_LEVELS = [
  'primary',
  'secondary',
  'undergraduate',
  'postgraduate',
  'other',
] as const

export type YouthEducationLevel = (typeof YOUTH_EDUCATION_LEVELS)[number]

export const YOUTH_STUDY_LEVELS = [
  'freshman',
  'sophomore',
  'junior',
  'senior',
  'final_year',
  'graduated',
  'n/a',
] as const

export type YouthStudyLevel = (typeof YOUTH_STUDY_LEVELS)[number]

/** §6.1 employment set. `entrepreneur` overlaps `is_entrepreneur` by design. */
export const YOUTH_EMPLOYMENT_STATUSES = [
  'student',
  'employed',
  'self_employed',
  'unemployed',
  'entrepreneur',
  'other',
] as const

export type YouthEmploymentStatus = (typeof YOUTH_EMPLOYMENT_STATUSES)[number]

export const YOUTH_PROFILE_STATUSES = ['active', 'inactive'] as const

export type YouthProfileStatus = (typeof YOUTH_PROFILE_STATUSES)[number]

export const YOUTH_PROFILE_EVENT_TYPES = ['created', 'updated', 'note'] as const

export type YouthProfileEventType = (typeof YOUTH_PROFILE_EVENT_TYPES)[number]

export interface YouthProfile {
  id: string
  person: string
  education_level: YouthEducationLevel | null
  institution: string | null
  course: string | null
  study_level: YouthStudyLevel | null
  employment_status: YouthEmploymentStatus | null
  professional_status: string | null
  is_entrepreneur: boolean
  youth_leadership_role: string | null
  /** Denorm via branch (Flow-maintained). */
  branch: string | null
  zone: string | null
  status: YouthProfileStatus
  created_at: string
  updated_at: string
}

export interface YouthProfileEvent {
  id: string
  profile: string
  event_type: YouthProfileEventType
  detail: string | null
  actor_user: string | null
  created_at: string
}

/** §6.2 celebration types, in document order. */
export const CELEBRATION_TYPES = [
  'birthday',
  'wedding_anniversary',
  'academic_success',
  'admission',
  'graduation',
  'scholarship',
  'other',
] as const

export type CelebrationType = (typeof CELEBRATION_TYPES)[number]

export const CELEBRATION_VISIBILITIES = ['internal', 'branch', 'public'] as const

export type CelebrationVisibility = (typeof CELEBRATION_VISIBILITIES)[number]

export const CELEBRATION_STATUSES = [
  'draft',
  'approved',
  'published',
  'archived',
] as const

export type CelebrationStatus = (typeof CELEBRATION_STATUSES)[number]

export const CELEBRATION_EVENT_TYPES = [
  'created',
  'approved',
  'published',
  'archived',
  'note',
] as const

export type CelebrationEventType = (typeof CELEBRATION_EVENT_TYPES)[number]

export interface Celebration {
  id: string
  person: string
  type: CelebrationType
  event_date: string
  is_recurring: boolean
  title: string | null
  message: string | null
  visibility: CelebrationVisibility
  /** Channel keys for the greeting (comms module sends; this row only names). */
  publish_channels: string[]
  /** Denorm via branch (Flow-maintained). */
  branch: string | null
  zone: string | null
  status: CelebrationStatus
  /** Stored minor safeguard: the route requires true for a minor's row. */
  guardian_consent: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CelebrationEvent {
  id: string
  celebration: string
  event_type: CelebrationEventType
  detail: string | null
  actor_user: string | null
  created_at: string
}

/** §4.3 previous-branch history row. */
export interface PersonPreviousBranch {
  id: string
  person: string
  branch_name: string | null
  branch: string | null
  role: string | null
  from_year: number | null
  to_year: number | null
}

/** §4.4 spiritual milestone row (date OR year, never neither). */
export interface PersonMilestone {
  id: string
  person: string
  milestone_type:
    'saved' | 'sanctified' | 'baptism_holy_ghost' | 'water_baptism' | 'other'
  milestone_date: string | null
  milestone_year: number | null
  church: string | null
  branch: string | null
  notes: string | null
  recorded_by: string | null
}

const youthProfileBaseSchema = z.object({
  education_level: z.enum(YOUTH_EDUCATION_LEVELS).optional(),
  institution: optionalText(255),
  course: optionalText(255),
  study_level: z.enum(YOUTH_STUDY_LEVELS).optional(),
  employment_status: z.enum(YOUTH_EMPLOYMENT_STATUSES).optional(),
  professional_status: optionalText(255),
  is_entrepreneur: z.boolean().default(false),
  youth_leadership_role: optionalText(255),
  branch: optionalText(36),
  zone: optionalText(36),
  status: z.enum(YOUTH_PROFILE_STATUSES).default('active'),
})

export const youthProfileFormSchema = youthProfileBaseSchema.extend({
  /** The shared-DB person link (US-Y1 AC2): required, 1-1, never a name. */
  person: z.string().uuid('Choose a person from the church database'),
})

export type YouthProfileForm = z.infer<typeof youthProfileFormSchema>

export const youthProfileUpdateSchema = youthProfileBaseSchema.partial()

export type YouthProfileUpdate = z.infer<typeof youthProfileUpdateSchema>

const channelKeySchema = z.string().trim().min(1).max(40)

const celebrationBaseSchema = z.object({
  type: z.enum(CELEBRATION_TYPES),
  event_date: dateSchema,
  is_recurring: z.boolean().default(false),
  title: optionalText(200),
  message: optionalNote(),
  visibility: z.enum(CELEBRATION_VISIBILITIES).default('internal'),
  publish_channels: z.array(channelKeySchema).max(10).default([]),
  branch: optionalText(36),
  zone: optionalText(36),
  guardian_consent: z.boolean().default(false),
})

export const celebrationFormSchema = celebrationBaseSchema.extend({
  person: z.string().uuid('Choose a person from the church database'),
})

export type CelebrationForm = z.infer<typeof celebrationFormSchema>

export const celebrationUpdateSchema = celebrationBaseSchema.partial().extend({
  /** Person moves are allowed in draft/approved with the minor re-check. */
  person: z.string().uuid('Choose a person from the church database').optional(),
})

export type CelebrationUpdate = z.infer<typeof celebrationUpdateSchema>

/**
 * Server-enforced lifecycle (US-Y3 AC2, acceptance: "visibility/status
 * lifecycle enforced server-side"). A publish names channels (the
 * `celebrations_published_needs_channel` CHECK is the second layer); an
 * archive is terminal; approved can return to draft for corrections.
 */
export const CELEBRATION_TRANSITIONS: Readonly<
  Record<CelebrationStatus, readonly CelebrationStatus[]>
> = {
  draft: ['approved', 'archived'],
  approved: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: [],
}

export function isCelebrationTransitionAllowed(
  from: CelebrationStatus,
  to: CelebrationStatus,
): boolean {
  return CELEBRATION_TRANSITIONS[from]?.includes(to) ?? false
}

/** §4.3 history form: year ranges only, branch link optional. */
export const personPreviousBranchSchema = z
  .object({
    person: z.string().uuid(),
    branch_name: optionalText(255),
    branch: optionalText(36),
    role: optionalText(120),
    from_year: z.coerce.number().int().min(1900).max(2100).optional(),
    to_year: z.coerce.number().int().min(1900).max(2100).optional(),
  })
  .refine(
    (row) =>
      row.from_year === undefined ||
      row.to_year === undefined ||
      row.from_year <= row.to_year,
    { message: 'From year must be on or before to year', path: ['to_year'] },
  )

export type PersonPreviousBranchForm = z.infer<typeof personPreviousBranchSchema>

/** §4.4 milestone form: date OR year (the table CHECK rejects neither). */
export const personMilestoneSchema = z
  .object({
    person: z.string().uuid(),
    milestone_type: z.enum([
      'saved',
      'sanctified',
      'baptism_holy_ghost',
      'water_baptism',
      'other',
    ]),
    milestone_date: dateSchema.optional(),
    milestone_year: z.coerce.number().int().min(1900).max(2100).optional(),
    church: optionalText(36),
    branch: optionalText(36),
    notes: optionalNote(),
  })
  .refine((row) => row.milestone_date !== undefined || row.milestone_year !== undefined, {
    message: 'Give a date or a year',
    path: ['milestone_date'],
  })

export type PersonMilestoneForm = z.infer<typeof personMilestoneSchema>

/**
 * Person §4.2 additions (data-model-expansion §4.2, AFC-476). All optional
 * so rows written before the youth slice still parse. `status` is
 * deliberately absent: the (active, archived) closure is a retention
 * control (suite 63) and the §4.2 expansion is withheld pending a CTO
 * decision (migration 0012 header) -- no form may offer values the table
 * refuses.
 */
export const personExtensionSchema = z.object({
  marital_status: z
    .enum(['single', 'married', 'widowed', 'divorced', 'separated', 'unspecified'])
    .optional(),
  marriage_date: dateSchema.optional(),
  occupation: optionalText(255),
  employment_status: z
    .enum(['employed', 'self_employed', 'unemployed', 'student', 'retired', 'other'])
    .optional(),
  education_level: z
    .enum(['none', 'primary', 'secondary', 'undergraduate', 'postgraduate', 'other'])
    .optional(),
  institution: optionalText(255),
  is_entrepreneur: z.boolean().optional(),
  professional_status: optionalText(255),
  /** Derived (age band) / overridable (expansion §4.2): a form may set it. */
  is_youth: z.boolean().optional(),
  locality: optionalText(255),
  sub_location: optionalText(255),
  person_type: z.enum(['visitor', 'member']).optional(),
})

export type PersonExtension = z.infer<typeof personExtensionSchema>

/**
 * Celebration feed query (US-Y2 AC1, US-Y3 AC3). `month`/`day` serve the
 * recurring feed (birthdays/anniversaries by month/day across years, the
 * `celebrations_recurring_md_idx` predicate); `date_from`/`date_to` serve
 * dated shout-outs. The list route intersects all of it with the scope
 * predicate, so a filter can only narrow inside the caller's scope.
 */
export const celebrationFeedQuerySchema = z.object({
  type: z.enum(CELEBRATION_TYPES).optional(),
  visibility: z.enum(CELEBRATION_VISIBILITIES).optional(),
  status: z.enum(CELEBRATION_STATUSES).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  day: z.coerce.number().int().min(1).max(31).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().trim().max(80).optional(),
})

export type CelebrationFeedQuery = z.infer<typeof celebrationFeedQuerySchema>

/** CSV column order: scope, who, what, when, lifecycle -- no PII beyond the name. */
export const CELEBRATION_CSV_COLUMNS = [
  'branch',
  'zone',
  'celebration',
  'date',
  'visibility',
  'status',
] as const

/** Youth CSV column order: scope + segment fields, no contact detail. */
export const YOUTH_CSV_COLUMNS = [
  'branch',
  'zone',
  'education_level',
  'employment_status',
  'status',
] as const
