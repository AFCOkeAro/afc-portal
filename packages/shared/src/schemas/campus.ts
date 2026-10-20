/**
 * Campus care contracts (AFC-484, prd-expansion §7 US-C1..US-C5,
 * data-model-expansion §7, ADR-0010 decisions 1-2).
 *
 * This file is the canonical vocabulary for the campus API slice: the
 * enums below are the single source the portal routes validate against,
 * transcribed from the migration 0003 CHECK constraints so a drift between
 * the route and the database is a compile-visible mismatch, not a silent
 * 500. `exam_results.scores` stays an open record (ADR-0010 tech-debt
 * ledger: extended deliberately, never to raw SQL).
 *
 * Canonical collection names live in `collections.ts` (AFC-483); this file
 * owns shapes only. The barrel (`schemas/index.ts`) wires this file in —
 * that one-line export lands with the owning slice to keep the shared-tree
 * diff attributable.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText } from './common'

export const CAMPUS_LEVELS = [
  'freshman',
  'sophomore',
  'junior',
  'senior',
  'final_year',
  'graduated',
  'other',
] as const

export type CampusLevel = (typeof CAMPUS_LEVELS)[number]

export const CAMPUS_STUDENT_STATUSES = ['active', 'inactive', 'graduated'] as const

export type CampusStudentStatus = (typeof CAMPUS_STUDENT_STATUSES)[number]

export const AFCF_HANDSHAKE_STATUSES = [
  'not_contacted',
  'contacted',
  'connected',
  'active',
  'declined',
] as const

export type AfcfHandshakeStatus = (typeof AFCF_HANDSHAKE_STATUSES)[number]

export const NYSC_STATUSES = [
  'not_deployed',
  'waiting_callup',
  'deployed',
  'serving',
  'completed',
  'exempt',
] as const

export type NyscStatus = (typeof NYSC_STATUSES)[number]

export const COACHING_EXAMS = ['waec', 'utme', 'other'] as const

export type CoachingExam = (typeof COACHING_EXAMS)[number]

export const COACHING_STATUSES = ['active', 'inactive'] as const

export const FACILITATOR_CALL_STATUSES = [
  'registered',
  'called',
  'confirmed',
  'declined',
] as const

export type FacilitatorCallStatus = (typeof FACILITATOR_CALL_STATUSES)[number]

export const CAMPUS_SUPPORT_STATUSES = ['proposed', 'approved', 'disbursed'] as const

export type CampusSupportStatus = (typeof CAMPUS_SUPPORT_STATUSES)[number]

export const RESULT_EXAMS = ['waec', 'utme', 'admission'] as const

export type ResultExam = (typeof RESULT_EXAMS)[number]

export const RESULT_STATUSES = [
  'pending',
  'passed',
  'failed',
  'admitted',
  'not_admitted',
] as const

export type ResultStatus = (typeof RESULT_STATUSES)[number]

export const WEEK_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

const timeSchema = z
  .string()
  .regex(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/, 'Time must be HH:MM')
  .nullish()

/** US-C1 AC1: a programme names the exam diet and the scope it serves. */
export const coachingProgrammeFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  exam: z.enum(COACHING_EXAMS),
  year: z.number().int().min(1900).max(2100).nullish(),
  area: z.string().uuid().nullish(),
  zone: z.string().uuid().nullish(),
  branch: z.string().uuid().nullish(),
  scope_note: optionalText(2000),
  status: z.enum(COACHING_STATUSES).default('active'),
})

export type CoachingProgrammeForm = z.infer<typeof coachingProgrammeFormSchema>

/** US-C1 AC1/AC2: a weekly slot with a facilitator; clash is a flag, not a refusal. */
export const coachingSlotFormSchema = z.object({
  programme: z.string().uuid('Choose a programme'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  facilitator: z.string().uuid().nullish(),
  day_of_week: z.enum(WEEK_DAYS),
  start_time: timeSchema,
  end_time: timeSchema,
  location: z.string().max(300).nullish(),
  capacity: z.number().int().min(0).nullish(),
  status: z.enum(COACHING_STATUSES).default('active'),
})

export type CoachingSlotForm = z.infer<typeof coachingSlotFormSchema>

/** US-C1 AC2: facilitator registration + call tracking. */
export const coachingFacilitatorFormSchema = z.object({
  person: z.string().uuid('Choose a person'),
  programme: z.string().uuid('Choose a programme'),
  subject: z.string().max(200).nullish(),
  registration_date: dateSchema.nullish(),
  call_status: z.enum(FACILITATOR_CALL_STATUSES).default('registered'),
  status: z.enum(COACHING_STATUSES).default('active'),
})

export type CoachingFacilitatorForm = z.infer<typeof coachingFacilitatorFormSchema>

/** US-C2 AC1: one row per (session, student, date); re-marking updates. */
export const classAttendanceMarkSchema = z.object({
  timetable: z.string().uuid().nullish(),
  programme: z.string().uuid().nullish(),
  class_date: dateSchema,
  campus_student: z.string().uuid().nullish(),
  person: z.string().uuid().nullish(),
  present: z.boolean().default(true),
})

export type ClassAttendanceMark = z.infer<typeof classAttendanceMarkSchema>

/** US-C2 AC2: an assessment with an optional score/max pair. */
export const coachingProgressFormSchema = z.object({
  campus_student: z.string().uuid().nullish(),
  person: z.string().uuid().nullish(),
  programme: z.string().uuid('Choose a programme'),
  assessment: z.string().max(200).nullish(),
  score: z.number().min(0).nullish(),
  max_score: z.number().positive().nullish(),
  progress_date: dateSchema.nullish(),
  remarks: optionalNote(),
})

export type CoachingProgressForm = z.infer<typeof coachingProgressFormSchema>

/** US-C3: one result per (student, exam, year); admission names the institution. */
export const examResultFormSchema = z.object({
  campus_student: z.string().uuid().nullish(),
  person: z.string().uuid().nullish(),
  exam: z.enum(RESULT_EXAMS),
  exam_year: z.number().int().min(1900).max(2100).nullish(),
  scores: z.record(z.unknown()).default({}),
  aggregate: z.string().max(50).nullish(),
  status: z.enum(RESULT_STATUSES).default('pending'),
  institution: z.string().max(300).nullish(),
})

export type ExamResultForm = z.infer<typeof examResultFormSchema>

/** US-C4/US-C5: the campus-care record — AFCF handshake, level, NYSC, check-ups. */
export const campusStudentFormSchema = z.object({
  person: z.string().uuid('Choose a person'),
  institution: z.string().uuid().nullish(),
  course: z.string().max(200).nullish(),
  level: z.enum(CAMPUS_LEVELS).default('freshman'),
  admission_year: z.number().int().min(1900).max(2100).nullish(),
  graduation_year: z.number().int().min(1900).max(2100).nullish(),
  coordinator: z.string().uuid().nullish(),
  afcf_handshake_status: z.enum(AFCF_HANDSHAKE_STATUSES).default('not_contacted'),
  afcmf_linked: z.boolean().default(false),
  nysc_status: z.enum(NYSC_STATUSES).default('not_deployed'),
  nysc_deployment: z.string().max(300).nullish(),
  next_checkup_date: dateSchema.nullish(),
  branch: z.string().uuid().nullish(),
  zone: z.string().uuid().nullish(),
  status: z.enum(CAMPUS_STUDENT_STATUSES).default('active'),
  notes: optionalNote(),
})

export type CampusStudentForm = z.infer<typeof campusStudentFormSchema>

/** US-C4 AC2: proposed → approved → disbursed; the total is derived, never captured. */
export const campusSupportFormSchema = z.object({
  student: z.string().uuid('Choose a student'),
  programme: z.string().uuid().nullish(),
  amount: z.number().min(0, 'Amount cannot be negative').nullish(),
  term: z.string().max(200).nullish(),
  source: z.string().max(300).nullish(),
  status: z.enum(CAMPUS_SUPPORT_STATUSES).default('proposed'),
  approved_by: z.string().uuid().nullish(),
  support_date: dateSchema.nullish(),
})

export type CampusSupportForm = z.infer<typeof campusSupportFormSchema>
