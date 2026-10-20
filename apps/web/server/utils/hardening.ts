/**
 * Hardening helpers (AFC-486, ADR-0010 decision 4).
 *
 * Retention/consent automation, per-run cost reporting, phone-identity
 * dedupe warnings, and monitoring checks — the route-layer half of Slice 5d.
 * The database half (STOP registry, rate card, dedupe reviews, monitor log,
 * pure predicates) lives in migration 20261020_0015; the scheduled halves
 * live in services/directus/flows/retention_consent_automation.json and
 * hardening_monitoring.json. No new service, secret, or dependency here:
 * every function below is pure over its inputs, and the transports stay the
 * stubbed ones from campaign-tick.ts.
 *
 * Retention-gate note: this file is scanned by
 * scripts/retention-literal-gate.sh. It names no retention period — the SLO
 * below is a five-minute tick window counted in minutes, and the campaign
 * guardrails (quiet hours, fallback window) stay in campaign-tick.ts.
 */

export const HARDENING_COLLECTIONS = {
  suppressions: 'communication_suppressions',
  costRates: 'campaign_cost_rates',
  duplicateReviews: 'person_duplicate_reviews',
  monitorChecks: 'hardening_monitor_checks',
} as const

// ---------------------------------------------------------------------------
// STOP / consent withdrawal (prd-addendum-v4 §3.3, US-N3 AC3).
//
// An inbound STOP suppresses ALL further sends to that number on the
// withdrawn channel — including other campaigns — and the withdrawal is
// recorded with a reason. The suppression row is defence in depth behind the
// audience-time consent resolver (comms_resolve_consent): opted_out already
// excludes at resolution, and hardening_suppressed() re-checks at tick time.
// ---------------------------------------------------------------------------

export type SuppressionChannel = 'whatsapp' | 'sms' | 'email' | 'all'

export type SuppressionReason =
  | 'opt_out_stop'
  | 'consent_withdrawn'
  | 'dnc'
  | 'invalid_contact'
  | 'over_cap_abuse'

export type SuppressionSource = 'member_reply' | 'staff_action' | 'flow' | 'tick'

const STOP_ALL_RE = /\bstop\s+all\b/i
const STOP_RE = /\b(stop|unsubscribe|opt\s*out|do\s*not\s*(contact|message|text)\s*me)\b/i

export interface StopParse {
  isStop: boolean
  allChannels: boolean
}

/** True when an inbound reply is a STOP; allChannels when it says STOP ALL. */
export function parseStopRequest(text: string | null | undefined): StopParse {
  if (!text || text.trim() === '') return { isStop: false, allChannels: false }
  if (STOP_ALL_RE.test(text)) return { isStop: true, allChannels: true }
  return { isStop: STOP_RE.test(text), allChannels: false }
}

export function suppressionChannelFor(
  replyChannel: 'whatsapp' | 'sms' | 'email',
  allChannels: boolean,
): SuppressionChannel {
  return allChannels ? 'all' : replyChannel
}

// ---------------------------------------------------------------------------
// Contact identity (hashes only past this point).
//
// The STOP registry and the dedupe reviews store hashes, never a raw phone
// number or name — the same posture as the prior-year ledger (0014), which
// keeps this slice out of the personal-data approval path. Canonicalisation
// (digit-only phone) is the only normalisation: two spellings of one number
// must hash alike, or the suppression misses.
// ---------------------------------------------------------------------------

/** Digit-only canonical form of a phone number for hashing. */
export function canonicalPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Canonical pre-image: name | digits | email, all lowered and trimmed. */
export function identityPreimage(parts: {
  name?: string | null
  phone?: string | null
  email?: string | null
}): string {
  const name = (parts.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const phone = canonicalPhoneDigits(parts.phone ?? '')
  const email = (parts.email ?? '').trim().toLowerCase()
  return [name, phone, email].join('|')
}

/** SHA-256 hex of the canonical pre-image (async: WebCrypto). */
export async function identityHash(parts: {
  name?: string | null
  phone?: string | null
  email?: string | null
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identityPreimage(parts)),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Cost reporting (US-C2 AC1). Estimate before send, actual after; the owner
// of every naira is the area admin.
// ---------------------------------------------------------------------------

export const COST_OWNER_ROLE = 'area_admin' as const
export const COST_CURRENCIES = ['NGN', 'USD', 'GBP'] as const
export const COST_CHANNELS = ['whatsapp', 'sms', 'email'] as const

export type CostChannel = (typeof COST_CHANNELS)[number]

/** Per-run estimate: audience × unit cost. A NULL (unset) rate raises. */
export function estimateRunCost(audienceSize: number, unitCost: number | null): number {
  if (!Number.isInteger(audienceSize) || audienceSize < 0) {
    throw new Error('hardening: audience size must be a non-negative integer')
  }
  if (unitCost === null) {
    throw new Error('hardening: unit cost is unset (procurement has not set the rate card)')
  }
  if (!(unitCost >= 0)) {
    throw new Error('hardening: unit cost must be non-negative')
  }
  return audienceSize * unitCost
}

/** Only area staff may publish the rate card. */
export function canPublishRates(role: string): boolean {
  return role === 'area_admin' || role === 'super_admin'
}

// ---------------------------------------------------------------------------
// Dedupe (US-N1 AC4). Phone-identity duplicate warning with a branch-admin
// merge / keep-separate decision. NEVER a silent auto-merge: nothing here
// writes a person row, and a terminal state without decider + reason is
// rejected — mirroring the person_duplicate_reviews CHECK.
// ---------------------------------------------------------------------------

export const DUPLICATE_DECISIONS = ['merged', 'kept_separate'] as const

export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number]

export interface DuplicateWarning {
  contact_hash: string
  person_a: string | null
  person_b: string | null
  branch: string | null
  status: 'pending'
}

export function buildDuplicateWarning(input: {
  contactHash: string
  personA?: string | null
  personB?: string | null
  branch?: string | null
}): DuplicateWarning {
  if (!input.contactHash || input.contactHash.trim() === '') {
    throw new Error('hardening: a contact hash is required for a duplicate warning')
  }
  if (input.personA && input.personB && input.personA === input.personB) {
    throw new Error('hardening: a duplicate warning needs two distinct people')
  }
  return {
    contact_hash: input.contactHash.trim(),
    person_a: input.personA ?? null,
    person_b: input.personB ?? null,
    branch: input.branch ?? null,
    status: 'pending',
  }
}

/** Mirrors the person_duplicate_reviews CHECK: terminal states need a decider + reason. */
export function validateDuplicateDecision(input: {
  status: string
  decidedBy?: string | null
  reason?: string | null
}): void {
  if (input.status === 'pending') {
    if (input.decidedBy ?? input.reason) {
      throw new Error('hardening: a pending warning carries no decision')
    }
    return
  }
  if (!(DUPLICATE_DECISIONS as readonly string[]).includes(input.status)) {
    throw new Error(`hardening: unknown duplicate status ${input.status}`)
  }
  if (!input.decidedBy || !input.reason || input.reason.trim() === '') {
    throw new Error('hardening: a merge/keep-separate decision needs a decider and a reason')
  }
}

// ---------------------------------------------------------------------------
// Monitoring (ADR-0009 consequences). Endpoint/schedule health, queue depth,
// tick SLO, exclusions-by-reason; Telegram staff alert on anomaly carrying
// ids and counts only — never message content (integrations-addendum §7).
// ---------------------------------------------------------------------------

export const MONITOR_CHECK_KEYS = [
  'endpoint_health',
  'schedule_health',
  'queue_depth',
  'tick_slo',
  'exclusions_audit',
  'pause_drill',
] as const

export type MonitorCheckKey = (typeof MONITOR_CHECK_KEYS)[number]

/** A due step meets the SLO when it begins within five minutes of its window. */
export const TICK_SLO_MINUTES = 5
/** Share of due steps meeting the SLO (measured over the monitor log). */
export const TICK_SLO_RATIO = 0.99

export function tickSloMet(windowAt: Date, beganAt: Date): boolean {
  if (!windowAt || !beganAt) {
    throw new Error('hardening: window and begin instants are both required')
  }
  return beganAt.getTime() <= windowAt.getTime() + TICK_SLO_MINUTES * 60 * 1000
}

/** Share of SLO-meeting runs across the monitor log window. */
export function tickSloRatio(met: number, total: number): number | null {
  if (total <= 0) return null
  return met / total
}

export function tickSloPassing(met: number, total: number): boolean | null {
  const ratio = tickSloRatio(met, total)
  if (ratio === null) return null
  return ratio >= TICK_SLO_RATIO
}

export type QueueDepthState = 'ok' | 'warn' | 'exceeded'

/** Queue-depth triage for due-but-unprocessed enrollments. */
export function queueDepthState(depth: number, warnAt: number, exceedAt: number): QueueDepthState {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('hardening: queue depth must be a non-negative integer')
  }
  if (depth >= exceedAt) return 'exceeded'
  if (depth >= warnAt) return 'warn'
  return 'ok'
}

export interface HardeningAlert {
  kind: 'monitor_check' | 'daily_cap' | 'tick_slo' | 'queue_depth'
  checkKey: MonitorCheckKey | null
  counts: Record<string, number>
  note: string
}

/**
 * Telegram staff alert payload. Carries check/run ids and counts so staff
 * can find the run; it never carries message content, contact values, or
 * rendered text.
 */
export function hardeningAlert(alert: HardeningAlert): { title: string; body: string } {
  const counts = Object.entries(alert.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  return {
    title: `Hardening alert: ${alert.kind}`,
    body: `check=${alert.checkKey ?? 'unknown'} ${counts} note=${alert.note}`,
  }
}

/** Exclusion reasons the audit accepts (campaign + retention sets combined). */
export const EXCLUSION_REASONS = [
  'no_consent',
  'minor_no_guardian_consent',
  'opted_out',
  'invalid_contact',
  'dnc',
  'over_cap',
  'held',
  'ladder_stage_not_reached',
  'already_deleted',
  'policy_delete_disabled',
  'indeterminate_anchor',
] as const

export function isKnownExclusionReason(reason: string): boolean {
  return (EXCLUSION_REASONS as readonly string[]).includes(reason)
}
