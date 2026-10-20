/**
 * Newcomer journey (AFC-471, data-model-v4 §2, parent AFC-462 Slice 2c).
 *
 * Stages, follow-ups, funnel, conversion + dedupe. The SQL half lives in
 * `services/directus/schema/migrations/20261020_0008_visitor_journey.sql`;
 * this module is the route/UI half: zod contracts plus the pure helpers the
 * routes and the contract test share.
 *
 * Two deliberate non-mirrors of the SQL, stated rather than hidden:
 * - The SQL `journey_can_advance` works on sequences; `canAdvanceStage`
 *   here works on stage keys through STAGE_ORDER, so the UI can disable the
 *   wrong buttons without a sequence lookup.
 * - Dedupe normalisation lives here (and in the route), not in SQL: matching
 *   phone/email across collections is a read-time warning, not a constraint.
 */
import { z } from 'zod'
import { dateSchema, optionalText } from './common'

/** The five seeded stages in walk order (migration §1 seed). */
export const JOURNEY_STAGE_KEYS = [
  'identify',
  'welcome',
  'pack',
  'dropoff',
  'follow_up',
] as const

export type JourneyStageKey = (typeof JOURNEY_STAGE_KEYS)[number]

export const JOURNEY_STAGE_META: Record<
  JourneyStageKey,
  {
    sequence: number
    targetDays: number
    requiresPack: boolean
    requiresVisitOutcome: boolean
  }
> = {
  identify: {
    sequence: 1,
    targetDays: 1,
    requiresPack: false,
    requiresVisitOutcome: false,
  },
  welcome: {
    sequence: 2,
    targetDays: 1,
    requiresPack: false,
    requiresVisitOutcome: false,
  },
  pack: { sequence: 3, targetDays: 2, requiresPack: true, requiresVisitOutcome: false },
  dropoff: {
    sequence: 4,
    targetDays: 7,
    requiresPack: false,
    requiresVisitOutcome: true,
  },
  follow_up: {
    sequence: 5,
    targetDays: 60,
    requiresPack: false,
    requiresVisitOutcome: false,
  },
}

/** The six board-list pack item keys (migration journey_required_pack_items). */
export const JOURNEY_PACK_ITEMS = [
  'literature',
  'sermon_notes',
  'gift_bag',
  'malt',
  'biscuits',
  'contact_card',
] as const

export const FOLLOW_UP_CHANNELS = [
  'whatsapp',
  'sms',
  'phone',
  'visit',
  'in_person',
] as const

export const FOLLOW_UP_OUTCOMES = [
  'reached',
  'no_answer',
  'requested_visit',
  'needs_support',
  'declined',
  'moved',
  'wrong_number',
  'integrated',
] as const

export const DROPOFF_OUTCOMES = [
  'pending',
  'address_confirmed',
  'moved',
  'not_home',
  'declined',
  'wrong_number',
] as const

/**
 * Key-to-key order rule. `from === null` is the initial capture and must land
 * on `identify`; otherwise exactly one step forward. Unknown keys never
 * advance -- the route turns that into a 400, never a guess.
 */
export function canAdvanceStage(from: string | null, to: string): boolean {
  const toIndex = (JOURNEY_STAGE_KEYS as readonly string[]).indexOf(to)
  if (toIndex < 0) return false
  if (from === null || from === undefined) return toIndex === 0
  const fromIndex = (JOURNEY_STAGE_KEYS as readonly string[]).indexOf(from)
  if (fromIndex < 0) return false
  return toIndex === fromIndex + 1
}

/** Sequence-level twin of SQL `journey_can_advance`, for the route/Flow. */
export function canAdvanceSequence(
  fromSeq: number | null,
  toSeq: number | null,
): boolean {
  if (toSeq === null || toSeq === undefined) return false
  if (fromSeq === null || fromSeq === undefined) return toSeq === 1
  return toSeq === fromSeq + 1
}

/** Twin of SQL `journey_pack_complete`: every required key checked. */
export function packChecklistComplete(
  checklist: unknown,
  required: readonly string[] = JOURNEY_PACK_ITEMS,
): boolean {
  if (required.length === 0) return true
  if (!Array.isArray(checklist)) return false
  return required.every((item) => checklist.includes(item))
}

/** Twin of SQL `journey_dropoff_complete`: a real outcome was recorded. */
export function dropoffOutcomeComplete(outcome: string | null | undefined): boolean {
  return typeof outcome === 'string' && outcome.trim() !== '' && outcome !== 'pending'
}

/**
 * Dedupe normalisation. Phones collapse to digits with a leading-zero
 * normalised to 234 (so `0803…`, `+234803…` and `234803…` match); emails
 * collapse to trimmed lowercase. Either field matching is a warning, never
 * a merge -- the branch admin decides.
 */
export function normalizeContactPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const normalised = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  return normalised.length >= 10 ? normalised : null
}

export function normalizeContactEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const normalised = email.trim().toLowerCase()
  return normalised.length > 0 ? normalised : null
}

export interface DuplicateCandidate {
  id: string
  collection: 'people' | 'visitors'
  name: string | null
  branch: string | null
  matchedOn: Array<'phone' | 'email'>
}

export function matchDuplicates(
  probe: { phone?: string | null; email?: string | null },
  candidates: Array<{
    id: string
    collection: 'people' | 'visitors'
    name: string | null
    branch: string | null
    phone?: string | null
    email?: string | null
  }>,
): DuplicateCandidate[] {
  const phone = normalizeContactPhone(probe.phone)
  const email = normalizeContactEmail(probe.email)
  if (!phone && !email) return []
  const hits: DuplicateCandidate[] = []
  for (const candidate of candidates) {
    const matchedOn: Array<'phone' | 'email'> = []
    if (phone && normalizeContactPhone(candidate.phone) === phone) matchedOn.push('phone')
    if (email && normalizeContactEmail(candidate.email) === email) matchedOn.push('email')
    if (matchedOn.length > 0) {
      hits.push({
        id: candidate.id,
        collection: candidate.collection,
        name: candidate.name,
        branch: candidate.branch,
        matchedOn,
      })
    }
  }
  return hits
}

export const journeyAdvanceSchema = z.object({
  to_stage: z.enum(JOURNEY_STAGE_KEYS),
  note: z.string().trim().max(2000).optional(),
  /** Full replacement checklist; required when entering the pack stage. */
  pack_checklist: z.array(z.string().trim().min(1)).max(32).optional(),
  /** Recorded visit outcome; required when entering the drop-off stage. */
  dropoff_outcome: z.enum(DROPOFF_OUTCOMES).optional(),
})

export type JourneyAdvance = z.infer<typeof journeyAdvanceSchema>

export const followUpFormSchema = z.object({
  contact_channel: z.enum(FOLLOW_UP_CHANNELS),
  outcome: z.enum(FOLLOW_UP_OUTCOMES),
  contact_at: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(4000).optional(),
  next_step: z.string().trim().max(500).optional(),
  next_follow_up_at: dateSchema
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  welfare_case: optionalText(36),
})

export type FollowUpForm = z.infer<typeof followUpFormSchema>

export const visitorConvertSchema = z.object({
  /** Link to this existing person instead of creating one (merge decision). */
  person_id: z.string().trim().min(1).max(36).optional(),
  /** Keep-separate still creates; link reuses. Absent person_id = create. */
  mode: z.enum(['create', 'link']).default('create'),
  first_name: z.string().trim().min(1).max(120).optional(),
  last_name: z.string().trim().min(1).max(120).optional(),
})

export type VisitorConvert = z.infer<typeof visitorConvertSchema>

export interface JourneyFunnelStage {
  key: JourneyStageKey
  sequence: number
  visitors: number
  newThisWeek: number
  avgDaysInStage: number | null
  overdue: number
}

export interface JourneyFunnelOfficer {
  officer: string | null
  dueToday: number
  overdue: number
  unassignedOver3d: number
}

export interface JourneyFunnel {
  stages: JourneyFunnelStage[]
  officers: JourneyFunnelOfficer[]
  totals: { visitors: number; overdue: number; unassignedOver3d: number }
}

export interface FunnelVisitorRow {
  journey_stage: string | null
  journey_stage_entered_at: string | null
  journey_started_at: string | null
  follow_up_owner: string | null
  next_check_in_at: string | null
}

/**
 * Funnel over loaded rows (attendance-report pattern: reporting is a query,
 * not a table). Overdue = entered_at older than the stage target_days.
 * Unassigned-over-3d = no owner and started more than 3 days ago.
 */
export function buildJourneyFunnel(
  rows: FunnelVisitorRow[],
  now: Date = new Date(),
): JourneyFunnel {
  const stageKeys = new Set(JOURNEY_STAGE_KEYS as readonly string[])
  const stages: JourneyFunnelStage[] = JOURNEY_STAGE_KEYS.map((key) => ({
    key,
    sequence: JOURNEY_STAGE_META[key].sequence,
    visitors: 0,
    newThisWeek: 0,
    avgDaysInStage: null,
    overdue: 0,
  }))
  const byKey = new Map(stages.map((stage) => [stage.key, stage]))
  const daysInStage = new Map<string, number[]>()
  const officerStats = new Map<string | null, JourneyFunnelOfficer>()
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  const officer = (owner: string | null): JourneyFunnelOfficer => {
    let row = officerStats.get(owner)
    if (!row) {
      row = { officer: owner, dueToday: 0, overdue: 0, unassignedOver3d: 0 }
      officerStats.set(owner, row)
    }
    return row
  }

  for (const row of rows) {
    const key =
      row.journey_stage && stageKeys.has(row.journey_stage)
        ? (row.journey_stage as JourneyStageKey)
        : ('identify' as JourneyStageKey)
    const stage = byKey.get(key)
    if (!stage) continue
    stage.visitors += 1

    const entered = row.journey_stage_entered_at
      ? Date.parse(row.journey_stage_entered_at)
      : Number.NaN
    if (!Number.isNaN(entered)) {
      const days = (now.getTime() - entered) / 86_400_000
      if (days >= 0) {
        if (days <= 7) stage.newThisWeek += 1
        const list = daysInStage.get(key) ?? []
        list.push(days)
        daysInStage.set(key, list)
        if (days > JOURNEY_STAGE_META[key].targetDays) stage.overdue += 1
      }
    }

    const stats = officer(row.follow_up_owner)
    const checkIn = row.next_check_in_at ? Date.parse(row.next_check_in_at) : Number.NaN
    if (!Number.isNaN(checkIn)) {
      const day = new Date(checkIn)
      const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
      if (dayStart === startOfToday.getTime()) stats.dueToday += 1
      if (checkIn < now.getTime()) stats.overdue += 1
    }
    if (!row.follow_up_owner && row.journey_started_at) {
      const started = Date.parse(`${row.journey_started_at}T00:00:00Z`)
      if (!Number.isNaN(started) && now.getTime() - started > 3 * 86_400_000) {
        stats.unassignedOver3d += 1
      }
    }
  }

  for (const stage of stages) {
    const list = daysInStage.get(stage.key) ?? []
    stage.avgDaysInStage =
      list.length > 0
        ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10
        : null
  }

  const officers = [...officerStats.values()].sort((a, b) =>
    (a.officer ?? '').localeCompare(b.officer ?? ''),
  )
  return {
    stages,
    officers,
    totals: {
      visitors: rows.length,
      overdue: stages.reduce((sum, stage) => sum + stage.overdue, 0),
      unassignedOver3d: officers.reduce((sum, row) => sum + row.unassignedOver3d, 0),
    },
  }
}
