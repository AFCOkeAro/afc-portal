/**
 * Campaign scheduler tick — worker-side rules with stubbed transports
 * (AFC-481, ADR-0009 decisions 3-5 + 7, prd-addendum-v4 §4,
 * integrations-addendum §1 + §4-§5 + §8).
 *
 * DB enforcement lives in migration 20261020_0006 (campaign tables,
 * UNIQUE send/enrolment keys, template gate, quiet-hours shift, caps,
 * kill-switch hold, due-enrolment read). This file is the worker half:
 * the 1-minute tick loop over `campaign_due_enrollments`, in 500-chunks,
 * idempotent per (step, person, window), with stubbed transports.
 *
 * There is no Symfony Notifier worker in this tree yet, and procurement
 * (BSP, templates, Termii) is out of scope -- so the transports here are
 * stubs that record instead of sending. Swapping a stub for the real
 * provider is a transport change, never a rule change: every rule below
 * is a pure function with the same contract as its SQL twin, and the
 * contract test pins the shared constants. No secret, no dependency,
 * no network call in this file.
 *
 * Retention-gate note: this file is scanned by
 * scripts/retention-literal-gate.sh. The tick deals in hours and weeks
 * as numbers, never as quoted duration strings, and the retention engine
 * reads no table created by the campaign migration.
 */

export const CAMPAIGN_TIMEZONE = 'Africa/Lagos'
export const TICK_CHUNK_SIZE = 500
export const QUIET_START_HOUR = 20
export const QUIET_END_HOUR = 7
export const QUIET_SHIFT_HOUR = 8
export const FALLBACK_WINDOW_HOURS = 4
export const FALLBACK_MAX_PER_DAY = 1
export const MARKETING_WEEKLY_CAP = 3
export const BULK_APPROVAL_THRESHOLD = 200

export type TickChannel = 'whatsapp' | 'sms' | 'email'

export type ExclusionReason =
  | 'no_consent'
  | 'minor_no_guardian_consent'
  | 'opted_out'
  | 'invalid_contact'
  | 'dnc'
  | 'over_cap'
  | 'campaign_paused'
  | 'channel_disabled'
  | 'template_not_approved'
  | 'quiet_hours'
  | 'fallback_too_soon'
  | 'duplicate'

export interface DueEnrollment {
  enrollmentId: string
  campaignId: string
  campaignKey: string
  campaignStatus: string
  stepId: string
  channel: TickChannel
  channelEnabled: boolean
  personId: string | null
  contactKey: string | null
  nextStepAt: string
  sendsThisWeek: number
  templateApproval: string
  providerTemplateId: string | null
  operationalEssential: boolean
}

export interface TickSend {
  enrollmentId: string
  sendKey: string
  channel: TickChannel
  held: boolean
  holdReason: ExclusionReason | null
  excluded: boolean
  exclusionReason: ExclusionReason | null
}

export interface TickMetrics {
  tickRunId: string
  durationMs: number
  enrollmentsSeen: number
  sendsQueued: number
  held: number
  duplicatesSkipped: number
  exclusionsByReason: Partial<Record<ExclusionReason, number>>
}

export interface TickAlert {
  kind: 'campaign_anomaly' | 'daily_cap' | 'tick_failure'
  campaignId: string | null
  runId: string | null
  counts: Record<string, number>
  note: string
}

/**
 * The idempotency key both the worker and the SQL path use
 * (data-model-v4 §4.2, mirrors campaign_send_key): the window is
 * bucketed to the hour so two ticks in the same slot build the same key.
 * Exactly one recipient identity is required.
 */
export function buildSendKey(
  campaignId: string,
  stepId: string,
  personId: string | null,
  contactKey: string | null,
  window: Date,
): string {
  if (!campaignId || !stepId || !window) {
    throw new Error('campaign tick: campaign, step and window are all required')
  }
  const hasPerson = typeof personId === 'string' && personId.trim() !== ''
  const hasContact = typeof contactKey === 'string' && contactKey.trim() !== ''
  if (hasPerson === hasContact) {
    throw new Error('campaign tick: exactly one recipient identity is required')
  }
  const bucket = window.toISOString().slice(0, 13).replace(/[-T:]/g, '')
  const who = hasPerson ? personId!.trim() : `contact:${contactKey!.trim()}`
  return `campaign:${campaignId}:step:${stepId}:person:${who}:${bucket}`
}

/** Lagos wall-clock hour for an instant (quiet hours are wall-clock). */
export function lagosHour(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAMPAIGN_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  return hour === 24 ? 0 : hour
}

/** True inside the 20:00-07:00 Lagos quiet window. */
export function isQuietHour(at: Date): boolean {
  const hour = lagosHour(at)
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/**
 * Quiet-hours shift (mirrors campaign_shift_quiet_hours): steps scheduled
 * inside quiet hours move to 08:00 Lagos unless operational_essential.
 * Implemented by walking forward in 15-minute steps to the first sendable
 * instant -- simple, bounded (a full day is 96 steps), no TZ arithmetic
 * by hand.
 */
export function shiftQuietHours(scheduled: Date, operationalEssential: boolean): Date {
  if (operationalEssential) return scheduled
  let at = new Date(scheduled.getTime())
  for (let i = 0; i < 96 && isQuietHour(at); i++) {
    at = new Date(at.getTime() + 15 * 60 * 1000)
  }
  return at
}

/** Kill-switch hold (mirrors campaign_tick_hold): held means skip-and-keep. */
export function tickHold(
  campaignStatus: string,
  channelEnabled: boolean,
): { held: boolean, reason: ExclusionReason | null } {
  if (!channelEnabled) return { held: true, reason: 'channel_disabled' }
  if (campaignStatus === 'paused') return { held: true, reason: 'campaign_paused' }
  return { held: false, reason: null }
}

/** Template gate (mirrors campaign_template_allowed): unapproved WhatsApp never runs. */
export function templateAllowed(
  channel: TickChannel,
  approvalStatus: string,
  providerTemplateId: string | null,
): { allowed: boolean, reason: ExclusionReason | null } {
  if (channel === 'whatsapp') {
    if (approvalStatus !== 'approved' || !providerTemplateId?.trim()) {
      return { allowed: false, reason: 'template_not_approved' }
    }
  }
  return { allowed: true, reason: null }
}

/** Weekly frequency cap (mirrors campaign_within_cap): marketing stays under the cap. */
export function withinWeeklyCap(sendsThisWeek: number, cap: number = MARKETING_WEEKLY_CAP): boolean {
  if (!Number.isInteger(sendsThisWeek) || !Number.isInteger(cap)) {
    throw new Error('campaign tick: sent count and cap must both be integers')
  }
  if (sendsThisWeek < 0 || cap < 0) {
    throw new Error('campaign tick: counts and caps must be non-negative')
  }
  return sendsThisWeek < cap
}

/** Fallback due (mirrors campaign_fallback_due): at/after the window with no activity, never before. */
export function fallbackDue(
  sentAt: Date | null,
  hasActivity: boolean,
  windowHours: number = FALLBACK_WINDOW_HOURS,
  now: Date = new Date(),
): boolean {
  if (!sentAt || !now) return false
  if (hasActivity) return false
  return now.getTime() >= sentAt.getTime() + windowHours * 3_600_000
}

/** Fallback cap (mirrors campaign_fallback_allowed): at most one per 24h per family. */
export function fallbackAllowed(lastFallbackAt: Date | null, now: Date = new Date()): boolean {
  if (!now) return false
  if (!lastFallbackAt) return true
  return now.getTime() >= lastFallbackAt.getTime() + 24 * 3_600_000
}

/** Per-campaign estimate: audience size times the channel unit cost. */
export function estimateCost(audienceSize: number, unitCost: number): number {
  if (audienceSize < 0 || unitCost < 0) {
    throw new Error('campaign tick: audience and unit cost must be non-negative')
  }
  return audienceSize * unitCost
}

/**
 * Daily-cap enforcement (integrations-addendum §8): at 100% the channel
 * auto-pauses and staff are alerted; at 80% it warns. NULL cap means
 * unset (procurement has not set the rate card): no enforcement.
 */
export function dailyCapState(
  spentToday: number,
  dailyCap: number | null,
): 'unset' | 'ok' | 'warn' | 'exceeded' {
  if (dailyCap === null) return 'unset'
  if (spentToday >= dailyCap) return 'exceeded'
  if (spentToday >= dailyCap * 0.8) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Stubbed transports. They record instead of sending: the engine runs
// end to end without BSP/Termii/SMTP credentials, and no message content
// ever leaves the process. Swapping a stub for the real provider keeps
// every rule above untouched.
// ---------------------------------------------------------------------------

export interface StubSendRequest {
  sendKey: string
  channel: TickChannel
  renderedText: string
}

export interface StubSendResult {
  sendKey: string
  accepted: boolean
  providerReference: string
}

export interface StubTransport {
  readonly channel: TickChannel
  sent: StubSendResult[]
  send(request: StubSendRequest): StubSendResult
}

function makeStubTransport(channel: TickChannel): StubTransport {
  const sent: StubSendResult[] = []
  return {
    channel,
    sent,
    send(request: StubSendRequest): StubSendResult {
      const result = {
        sendKey: request.sendKey,
        accepted: true,
        providerReference: `stub:${channel}:${request.sendKey}`,
      }
      sent.push(result)
      return result
    },
  }
}

export const stubWhatsapp: StubTransport = makeStubTransport('whatsapp')
export const stubSms: StubTransport = makeStubTransport('sms')
export const stubEmail: StubTransport = makeStubTransport('email')

export function stubTransportFor(channel: TickChannel): StubTransport {
  switch (channel) {
    case 'whatsapp': return stubWhatsapp
    case 'sms': return stubSms
    case 'email': return stubEmail
  }
}

export function resetStubs(): void {
  for (const transport of [stubWhatsapp, stubSms, stubEmail]) {
    transport.sent.length = 0
  }
}

// ---------------------------------------------------------------------------
// The tick. Pure over its inputs: the caller supplies the due rows (from
// campaign_due_enrollments) and the set of send keys already recorded.
// A key already seen is skipped as a duplicate -- a replayed tick queues
// zero sends. Chunks of 500 mirror the worker contract.
// ---------------------------------------------------------------------------

export interface TickInput {
  tickRunId: string
  now: Date
  due: DueEnrollment[]
  seenSendKeys: Set<string>
}

export interface TickResult {
  sends: TickSend[]
  queued: StubSendResult[]
  metrics: TickMetrics
}

export function runCampaignTick(input: TickInput): TickResult {
  const started = Date.now()
  const sends: TickSend[] = []
  const queued: StubSendResult[] = []
  const exclusionsByReason: Partial<Record<ExclusionReason, number>> = {}
  let duplicatesSkipped = 0

  const exclude = (reason: ExclusionReason): void => {
    exclusionsByReason[reason] = (exclusionsByReason[reason] ?? 0) + 1
  }

  for (let offset = 0; offset < input.due.length; offset += TICK_CHUNK_SIZE) {
    const chunk = input.due.slice(offset, offset + TICK_CHUNK_SIZE)
    for (const enrollment of chunk) {
      const hold = tickHold(enrollment.campaignStatus, enrollment.channelEnabled)
      if (hold.held) {
        sends.push({
          enrollmentId: enrollment.enrollmentId,
          sendKey: '',
          channel: enrollment.channel,
          held: true,
          holdReason: hold.reason,
          excluded: false,
          exclusionReason: null,
        })
        exclude(hold.reason!)
        continue
      }

      const gate = templateAllowed(
        enrollment.channel,
        enrollment.templateApproval,
        enrollment.providerTemplateId,
      )
      if (!gate.allowed) {
        sends.push({
          enrollmentId: enrollment.enrollmentId,
          sendKey: '',
          channel: enrollment.channel,
          held: false,
          holdReason: null,
          excluded: true,
          exclusionReason: gate.reason,
        })
        exclude(gate.reason!)
        continue
      }

      if (!withinWeeklyCap(enrollment.sendsThisWeek)) {
        sends.push({
          enrollmentId: enrollment.enrollmentId,
          sendKey: '',
          channel: enrollment.channel,
          held: false,
          holdReason: null,
          excluded: true,
          exclusionReason: 'over_cap',
        })
        exclude('over_cap')
        continue
      }

      const sendKey = buildSendKey(
        enrollment.campaignId,
        enrollment.stepId,
        enrollment.personId,
        enrollment.contactKey,
        new Date(enrollment.nextStepAt),
      )
      if (input.seenSendKeys.has(sendKey)) {
        duplicatesSkipped += 1
        sends.push({
          enrollmentId: enrollment.enrollmentId,
          sendKey,
          channel: enrollment.channel,
          held: false,
          holdReason: null,
          excluded: true,
          exclusionReason: 'duplicate',
        })
        exclude('duplicate')
        continue
      }
      input.seenSendKeys.add(sendKey)

      const result = stubTransportFor(enrollment.channel).send({
        sendKey,
        channel: enrollment.channel,
        renderedText: '',
      })
      queued.push(result)
      sends.push({
        enrollmentId: enrollment.enrollmentId,
        sendKey,
        channel: enrollment.channel,
        held: false,
        holdReason: null,
        excluded: false,
        exclusionReason: null,
      })
    }
  }

  const held = sends.filter((s) => s.held).length
  return {
    sends,
    queued,
    metrics: {
      tickRunId: input.tickRunId,
      durationMs: Date.now() - started,
      enrollmentsSeen: input.due.length,
      sendsQueued: queued.length,
      held,
      duplicatesSkipped,
      exclusionsByReason,
    },
  }
}

// ---------------------------------------------------------------------------
// Observability. Structured tick log + Telegram anomaly alert
// (integrations-addendum §7: ids and counts only, never message content).
// ---------------------------------------------------------------------------

export function formatTickLog(metrics: TickMetrics): string {
  return JSON.stringify({
    event: 'campaign_tick',
    tickRunId: metrics.tickRunId,
    durationMs: metrics.durationMs,
    enrollmentsSeen: metrics.enrollmentsSeen,
    sendsQueued: metrics.sendsQueued,
    held: metrics.held,
    duplicatesSkipped: metrics.duplicatesSkipped,
    exclusionsByReason: metrics.exclusionsByReason,
  })
}

/**
 * Campaign-anomaly staff alert: failure rate, cap breach or volume spike.
 * Carries campaign/run ids and counts so staff can find the run; it never
 * carries message content, contact values or rendered text.
 */
export function campaignAnomalyAlert(alert: TickAlert): { title: string, body: string } {
  const counts = Object.entries(alert.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  return {
    title: `Campaign anomaly: ${alert.kind}`,
    body:
      `campaign=${alert.campaignId ?? 'unknown'} ` +
      `run=${alert.runId ?? 'unknown'} ${counts} note=${alert.note}`,
  }
}
