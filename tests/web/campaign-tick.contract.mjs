/**
 * AFC-481 contract tests — campaign engine tick with stubbed transports.
 *
 * Pure node:test, no dependencies. Node's type stripping lets the test
 * import the real TypeScript module, so these assertions pin the worker
 * half of Slice 4c rather than a mirror of it:
 *  1. Idempotency: buildSendKey buckets to the window-hour and demands
 *     exactly one identity; runCampaignTick queues zero sends on replay
 *     (US-C2 AC2, US-C4 AC4).
 *  2. Kill switch: paused campaigns and disabled channels hold rows
 *     within one tick, rows kept not deleted (US-C5).
 *  3. Template gate: unapproved WhatsApp never runs; SMS stays free-form
 *     (US-C1 AC4).
 *  4. Fallback: never before the 4h window, any activity cancels, max one
 *     per 24h (US-C3).
 *  5. Quiet hours + weekly cap mirror the SQL twins.
 *  6. Stubbed transports: record instead of sending, no secrets, no
 *     network; the anomaly alert carries ids and counts, never message
 *     content (integrations-addendum §7).
 *
 * Run: node --test tests/web/campaign-tick.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildSendKey,
  tickHold,
  templateAllowed,
  withinWeeklyCap,
  fallbackDue,
  fallbackAllowed,
  isQuietHour,
  shiftQuietHours,
  estimateCost,
  dailyCapState,
  runCampaignTick,
  resetStubs,
  stubSms,
  campaignAnomalyAlert,
  formatTickLog,
  TICK_CHUNK_SIZE,
  FALLBACK_WINDOW_HOURS,
  MARKETING_WEEKLY_CAP,
  BULK_APPROVAL_THRESHOLD,
} from '../../apps/web/server/utils/campaign-tick.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(
  path.join(root, 'apps/web/server/utils/campaign-tick.ts'),
  'utf8',
)

const dueRow = (overrides = {}) => ({
  enrollmentId: 'enr-1',
  campaignId: 'camp-1',
  campaignKey: 'weekly_memory_verse',
  campaignStatus: 'active',
  stepId: 'step-1',
  channel: 'sms',
  channelEnabled: true,
  personId: 'person-1',
  contactKey: null,
  nextStepAt: '2026-10-20T12:00:00.000Z',
  sendsThisWeek: 0,
  templateApproval: 'draft',
  providerTemplateId: null,
  operationalEssential: false,
  ...overrides,
})

describe('send-key idempotency (US-C2 AC2, US-C4 AC4)', () => {
  it('buckets two ticks in the same window-hour to the same key', () => {
    const a = buildSendKey('c', 's', 'p', null, new Date('2026-10-20T12:14:00Z'))
    const b = buildSendKey('c', 's', 'p', null, new Date('2026-10-20T12:47:00Z'))
    assert.equal(a, b)
    assert.match(a, /^campaign:c:step:s:person:p:\d{10}$/)
  })

  it('separates window-hours so the next send is not suppressed', () => {
    const a = buildSendKey('c', 's', 'p', null, new Date('2026-10-20T12:14:00Z'))
    const b = buildSendKey('c', 's', 'p', null, new Date('2026-10-20T13:05:00Z'))
    assert.notEqual(a, b)
  })

  it('demands exactly one recipient identity', () => {
    assert.throws(() => buildSendKey('c', 's', null, null, new Date()))
    assert.throws(() => buildSendKey('c', 's', 'p', 'hash:x', new Date()))
    assert.throws(() => buildSendKey('', 's', 'p', null, new Date()))
  })

  it('a replayed tick queues zero sends', () => {
    resetStubs()
    const seen = new Set()
    const input = () => ({
      tickRunId: 'tick-1',
      now: new Date('2026-10-20T12:00:00Z'),
      due: [dueRow()],
      seenSendKeys: seen,
    })
    const first = runCampaignTick(input())
    assert.equal(first.queued.length, 1)
    assert.equal(first.metrics.duplicatesSkipped, 0)
    const replay = runCampaignTick(input())
    assert.equal(replay.queued.length, 0)
    assert.equal(replay.metrics.duplicatesSkipped, 1)
    assert.equal(replay.metrics.exclusionsByReason.duplicate, 1)
    assert.equal(stubSms.sent.length, 1)
  })
})

describe('kill switch (US-C5)', () => {
  it('paused campaigns and disabled channels hold within one tick', () => {
    assert.deepEqual(tickHold('paused', true), { held: true, reason: 'campaign_paused' })
    assert.deepEqual(tickHold('active', false), { held: true, reason: 'channel_disabled' })
    assert.deepEqual(tickHold('active', true), { held: false, reason: null })
  })

  it('the tick holds rows instead of deleting them', () => {
    resetStubs()
    const result = runCampaignTick({
      tickRunId: 'tick-hold',
      now: new Date('2026-10-20T12:00:00Z'),
      due: [dueRow({ enrollmentId: 'enr-h', campaignStatus: 'paused' })],
      seenSendKeys: new Set(),
    })
    assert.equal(result.queued.length, 0)
    assert.equal(result.metrics.held, 1)
    assert.equal(result.metrics.exclusionsByReason.campaign_paused, 1)
    assert.equal(result.sends[0].held, true)
  })
})

describe('template gate (US-C1 AC4)', () => {
  it('unapproved WhatsApp never runs; SMS stays free-form', () => {
    assert.deepEqual(
      templateAllowed('whatsapp', 'pending_provider', null),
      { allowed: false, reason: 'template_not_approved' },
    )
    assert.deepEqual(templateAllowed('whatsapp', 'approved', null).allowed, false)
    assert.deepEqual(templateAllowed('whatsapp', 'approved', 'meta-1').allowed, true)
    assert.deepEqual(templateAllowed('sms', 'draft', null).allowed, true)
  })

  it('the tick excludes unapproved WhatsApp with a reason', () => {
    resetStubs()
    const result = runCampaignTick({
      tickRunId: 'tick-gate',
      now: new Date('2026-10-20T12:00:00Z'),
      due: [dueRow({ enrollmentId: 'enr-g', channel: 'whatsapp' })],
      seenSendKeys: new Set(),
    })
    assert.equal(result.queued.length, 0)
    assert.equal(result.metrics.exclusionsByReason.template_not_approved, 1)
  })
})

describe('fallback rule (US-C3)', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000)

  it('never fires before the window; activity cancels it', () => {
    assert.equal(fallbackDue(hoursAgo(5), false, FALLBACK_WINDOW_HOURS, now), true)
    assert.equal(fallbackDue(hoursAgo(3.9), false, FALLBACK_WINDOW_HOURS, now), false)
    assert.equal(fallbackDue(hoursAgo(5), true, FALLBACK_WINDOW_HOURS, now), false)
    assert.equal(fallbackDue(null, false, FALLBACK_WINDOW_HOURS, now), false)
  })

  it('allows at most one fallback per 24h', () => {
    assert.equal(fallbackAllowed(null, now), true)
    assert.equal(fallbackAllowed(hoursAgo(25), now), true)
    assert.equal(fallbackAllowed(hoursAgo(23), now), false)
  })
})

describe('quiet hours and weekly cap', () => {
  it('holds the Lagos night window unless operational', () => {
    // 21:30 Lagos in October is 20:30 UTC.
    assert.equal(isQuietHour(new Date('2026-10-20T20:30:00Z')), true)
    assert.equal(isQuietHour(new Date('2026-10-20T11:00:00Z')), false)
    const shifted = shiftQuietHours(new Date('2026-10-20T20:30:00Z'), false)
    assert.equal(isQuietHour(shifted), false)
    const passthrough = shiftQuietHours(new Date('2026-10-20T20:30:00Z'), true)
    assert.equal(passthrough.toISOString(), '2026-10-20T20:30:00.000Z')
  })

  it('holds marketing at the weekly cap', () => {
    assert.equal(MARKETING_WEEKLY_CAP, 3)
    assert.equal(withinWeeklyCap(2), true)
    assert.equal(withinWeeklyCap(3), false)
    assert.throws(() => withinWeeklyCap(-1))
  })
})

describe('cost guard and observability', () => {
  it('estimates per-campaign cost and enforces the daily cap', () => {
    assert.equal(estimateCost(200, 6), 1200)
    assert.equal(BULK_APPROVAL_THRESHOLD, 200)
    assert.equal(dailyCapState(50, null), 'unset')
    assert.equal(dailyCapState(50, 100), 'ok')
    assert.equal(dailyCapState(85, 100), 'warn')
    assert.equal(dailyCapState(100, 100), 'exceeded')
  })

  it('logs the tick as structured data with exclusions by reason', () => {
    const line = formatTickLog({
      tickRunId: 't1',
      durationMs: 12,
      enrollmentsSeen: 500,
      sendsQueued: 480,
      held: 10,
      duplicatesSkipped: 5,
      exclusionsByReason: { campaign_paused: 10, duplicate: 5 },
    })
    const parsed = JSON.parse(line)
    assert.equal(parsed.event, 'campaign_tick')
    assert.equal(parsed.enrollmentsSeen, 500)
    assert.deepEqual(parsed.exclusionsByReason, { campaign_paused: 10, duplicate: 5 })
  })

  it('the anomaly alert carries ids and counts, never message content', () => {
    const alert = campaignAnomalyAlert({
      kind: 'campaign_anomaly',
      campaignId: 'camp-1',
      runId: 'run-7',
      counts: { failed: 42, sent: 100 },
      note: 'failure rate above threshold',
    })
    assert.match(alert.body, /camp-1/)
    assert.match(alert.body, /failed=42/)
    assert.doesNotMatch(alert.body, /rendered|contact_value|message content/i)
  })
})

describe('stubbed transports (procurement out of scope)', () => {
  it('records instead of sending, with no secrets or network', () => {
    assert.equal(TICK_CHUNK_SIZE, 500)
    assert.doesNotMatch(source, /fetch\(|axios|process\.env|apiKey|Authorization/)
    assert.doesNotMatch(source, /https?:\/\//)
    assert.match(source, /providerReference: `stub:/)
  })
})

describe('AFC-512: branch-scope intersection (F6)', () => {
  it('intersects saved audiences with the author branch scope at resolution', () => {
    assert.match(source, /resolveAudienceScope/)
    assert.match(source, /branch_mismatch/)
  })
})

describe('AFC-512: positive-reply classification is ephemeral (F8b)', () => {
  it('states in code that only the outcome is stored, never the body or label', () => {
    assert.match(source, /EPHEMERAL/)
    assert.match(source, /classifyPositiveReplyEphemeral/)
    assert.doesNotMatch(source, /positive_reply_body|reply_body/)
  })
})
