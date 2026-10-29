/**
 * Trigger-chain preview builder (AFC-868, follow-up to AFC-586).
 *
 * Read-only renderer model for the "Upon Joining a Group" sample: a trigger
 * pill plus a vertical wait-then-send spine. Every rule below reuses the
 * campaign-tick constants (quiet-hours window, hold/template gates) instead
 * of restating them, so the preview can never drift from the worker.
 *
 * Stated choice: this is a PREVIEW, not a schedule. Day pills and wait
 * labels are computed from an anchor date the caller supplies (the page
 * defaults to today and says so). No enrollment, contact, or recipient row
 * is read here — the caller passes already-scoped campaign + step rows.
 * Builder editing stays in AFC-586 scope; this file builds, never writes.
 *
 * Retention-gate note: waits are numbers (days as integers), never quoted
 * duration strings — labels are assembled with template parts.
 */

import {
  QUIET_END_HOUR,
  QUIET_START_HOUR,
  shiftQuietHours,
  templateAllowed,
  tickHold,
  type TickChannel,
} from './campaign-tick'

export const TRIGGER_UPON_JOINING_GROUP = 'upon_joining_group'

export type ChainChannelIcon = 'chat' | 'sms' | 'email' | 'calendar'

export type ChainNodeStatus = 'sendable' | 'held' | 'blocked'

export interface ChainStepInput {
  sequence: number
  name: string
  delay_type: string
  delay_value: string | null
  channel_key: string
  channel_enabled: boolean | null
  template_approval_status: string | null
  template_provider_id: string | null
  is_entry_step: boolean
  active: boolean
  /** Worker-evaluated gate for this step; empty means the step always runs. */
  condition: Record<string, unknown> | null
}

export interface ChainNode {
  sequence: number
  name: string
  /** Decision question for a conditional step; null means the step always runs. */
  condition_label: string | null
  /** Step after YES (this step runs first); null means the workflow ends. */
  yes_to: string | null
  /** Step after NO (this step is skipped); null means the workflow ends. */
  no_to: string | null
  /** Whole days waited before this node; null means event/cron-driven. */
  wait_days: number | null
  wait_label: string
  channel_key: string
  channel_icon: ChainChannelIcon
  /** ISO instant of the previewed send (anchor + wait, quiet-shifted). */
  scheduled_at: string | null
  /** Weekday pill of the previewed send (Mon..Sun); null when unscheduled. */
  day_pill: string | null
  status: ChainNodeStatus
  status_reason: string | null
  quiet_hours_note: string
  consent_note: string
  template_note: string | null
}

export interface TriggerChain {
  trigger: typeof TRIGGER_UPON_JOINING_GROUP
  trigger_label: string
  campaign_key: string
  campaign_name: string
  consent_policy: string
  anchor_at: string
  node_count: number
  nodes: ChainNode[]
}

export interface BuildTriggerChainInput {
  campaign_key: string
  campaign_name: string
  consent_policy: string
  campaign_status: string
  quiet_hours_override: boolean
  steps: ChainStepInput[]
  anchor: Date
}

/**
 * Whole-day wait for a step (sample spine: Wait 0 / 0 / 1 / 2 Days).
 * immediate and sub-day delays render as 0; weekly_cron and wait_for_event
 * have no day count (null) and render their own label.
 */
export function waitDaysFromDelay(
  delay_type: string,
  delay_value: string | null,
): number | null {
  if (delay_type === 'immediate') return 0
  if (delay_type === 'delay_days') {
    const parsed = Number.parseInt(String(delay_value ?? ''), 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
  }
  if (delay_type === 'delay_hours') {
    const parsed = Number.parseFloat(String(delay_value ?? ''))
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.floor(parsed / 24)
  }
  return null
}

export function waitLabelFor(wait_days: number | null, delay_type: string): string {
  if (wait_days !== null) {
    return 'Wait ' + String(wait_days) + ' ' + (wait_days === 1 ? 'Day' : 'Days')
  }
  if (delay_type === 'weekly_cron') return 'Weekly send'
  return 'Wait for event'
}

/**
 * Channel icon for the spine card (sample: calendar / email / SMS glyphs).
 * whatsapp renders as chat; anything unrecognised falls back to calendar
 * (event-flavoured steps), never to a hidden node.
 */
export function channelIconFor(
  channel_key: string,
  delay_type: string,
): ChainChannelIcon {
  const key = channel_key.trim().toLowerCase()
  if (key === 'sms') return 'sms'
  if (key === 'email') return 'email'
  if (key === 'whatsapp') return 'chat'
  if (delay_type === 'weekly_cron') return 'calendar'
  return 'calendar'
}

const LAGOS_TIMEZONE = 'Africa/Lagos'
const WEEKDAY_PILLS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Lagos weekday pill for an instant (quiet hours are wall-clock). */
export function lagosDayPill(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TIMEZONE,
    weekday: 'short',
  }).formatToParts(at)
  const raw = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const pill = raw.slice(0, 3)
  return (WEEKDAY_PILLS as readonly string[]).includes(pill) ? pill : raw
}

/**
 * Previewed send instant: anchor plus the whole-day wait, then the shared
 * quiet-hours shift (campaigns with the operational-essential override skip
 * the shift — same rule the tick enforces).
 */
export function scheduledAtFor(
  anchor: Date,
  wait_days: number,
  operationalEssential: boolean,
): Date {
  const raw = new Date(anchor.getTime() + wait_days * 86_400_000)
  return shiftQuietHours(raw, operationalEssential)
}

export function quietHoursNoteFor(
  raw: Date,
  shifted: Date,
  operationalEssential: boolean,
): string {
  if (operationalEssential) return 'Operational-essential: sends inside quiet hours'
  if (shifted.getTime() !== raw.getTime()) {
    return (
      'Quiet-hours rule: held to 08:00 Lagos (' +
      String(QUIET_START_HOUR) +
      ':00 to 0' +
      String(QUIET_END_HOUR) +
      ':00 window)'
    )
  }
  return 'Inside the send window (08:00 to 20:00 Lagos)'
}

export function consentNoteFor(consent_policy: string): string {
  const policy = consent_policy.trim().toLowerCase()
  if (policy === 'operational_essential') {
    return 'Operational-essential: sends without marketing consent'
  }
  if (policy === 'mixed') {
    return 'Mixed policy: each step states its own consent basis'
  }
  return 'Needs marketing consent: opted-out and do-not-contact excluded'
}

function asTickChannel(channel_key: string): TickChannel {
  const key = channel_key.trim().toLowerCase()
  if (key === 'sms' || key === 'email' || key === 'whatsapp') return key
  return 'sms'
}

export function nodeStatusFor(input: {
  campaign_status: string
  channel_key: string
  channel_enabled: boolean | null
  template_approval_status: string | null
  template_provider_id: string | null
  active: boolean
}): { status: ChainNodeStatus; reason: string | null } {
  if (!input.active) return { status: 'blocked', reason: 'step_inactive' }
  const hold = tickHold(input.campaign_status, input.channel_enabled ?? true)
  if (hold.held) return { status: 'held', reason: hold.reason }
  const gate = templateAllowed(
    asTickChannel(input.channel_key),
    input.template_approval_status ?? 'unknown',
    input.template_provider_id,
  )
  if (!gate.allowed) return { status: 'blocked', reason: gate.reason }
  return { status: 'sendable', reason: null }
}

/**
 * Human question for a worker-evaluated condition (data-model-v4 §4.2
 * predicates). Unknown shapes degrade to a humanised key question rather
 * than hiding the gate — the diagram never hides config.
 */
export function conditionLabelFor(
  condition: Record<string, unknown> | null | undefined,
): string | null {
  if (!condition || typeof condition !== 'object') return null
  const entries = Object.entries(condition).filter(
    (entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== false,
  )
  if (entries.length === 0) return null
  const pretty = (key: string): string =>
    key
      .split('_')
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ')
  const labels = entries.map(([key, value]) => {
    if (key === 'whatsapp_registered_no_activity')
      return 'WhatsApp registered with no activity?'
    if (key === 'consent_sms') return 'SMS consent given?'
    if (key === 'not_opted_out') return 'Not opted out?'
    if (key === 'has_milestone')
      return typeof value === 'string' && value.trim() !== ''
        ? `Milestone reached (${value.trim()})?`
        : 'Milestone reached?'
    if (key === 'stage_equals')
      return typeof value === 'string' && value.trim() !== ''
        ? `Stage equals ${value.trim()}?`
        : 'Stage equals?'
    if (typeof value === 'string' && value.trim() !== '')
      return `${pretty(key)} (${value.trim()})?`
    return `${pretty(key)}?`
  })
  return labels.join(' and ')
}

export function templateNoteFor(
  channel_key: string,
  approval_status: string | null,
  provider_template_id: string | null,
): string | null {
  if (asTickChannel(channel_key) !== 'whatsapp') return null
  if (approval_status === 'approved' && provider_template_id?.trim()) {
    return 'Template approved for WhatsApp send'
  }
  return 'Template gate: unapproved WhatsApp never runs'
}

/**
 * Build the preview chain (steps already sorted by sequence by the caller).
 * Inactive steps stay visible with a blocked dot — the spine never hides
 * config, matching the campaign-detail read-only rule.
 */
export function buildTriggerChain(input: BuildTriggerChainInput): TriggerChain {
  const operationalEssential = input.quiet_hours_override === true
  const consent_note = consentNoteFor(input.consent_policy)
  const nodes: ChainNode[] = input.steps.map((step, index) => {
    const wait_days = waitDaysFromDelay(step.delay_type, step.delay_value)
    let scheduled_at: string | null = null
    let day_pill: string | null = null
    let quiet_note: string
    if (wait_days === null) {
      quiet_note = 'Event-driven: quiet-hours shift applies at fire time'
    } else {
      const raw = new Date(input.anchor.getTime() + wait_days * 86_400_000)
      const shifted = shiftQuietHours(raw, operationalEssential)
      scheduled_at = shifted.toISOString()
      day_pill = lagosDayPill(shifted)
      quiet_note = quietHoursNoteFor(raw, shifted, operationalEssential)
    }
    const condition_label = conditionLabelFor(
      (step.condition ?? null) as Record<string, unknown> | null,
    )
    const nextName =
      index + 1 < input.steps.length ? (input.steps[index + 1]?.name ?? null) : null
    const verdict = nodeStatusFor({
      campaign_status: input.campaign_status,
      channel_key: step.channel_key,
      channel_enabled: step.channel_enabled,
      template_approval_status: step.template_approval_status,
      template_provider_id: step.template_provider_id,
      active: step.active,
    })
    return {
      sequence: step.sequence,
      name: step.name,
      condition_label,
      yes_to: condition_label === null ? null : nextName,
      no_to: condition_label === null ? null : nextName,
      wait_days,
      wait_label: waitLabelFor(wait_days, step.delay_type),
      channel_key: step.channel_key,
      channel_icon: channelIconFor(step.channel_key, step.delay_type),
      scheduled_at,
      day_pill,
      status: verdict.status,
      status_reason: verdict.reason,
      quiet_hours_note: quiet_note,
      consent_note,
      template_note: templateNoteFor(
        step.channel_key,
        step.template_approval_status,
        step.template_provider_id,
      ),
    }
  })
  return {
    trigger: TRIGGER_UPON_JOINING_GROUP,
    trigger_label: 'Workflow Trigger - Upon Joining a Group',
    campaign_key: input.campaign_key,
    campaign_name: input.campaign_name,
    consent_policy: input.consent_policy,
    anchor_at: input.anchor.toISOString(),
    node_count: nodes.length,
    nodes,
  }
}
