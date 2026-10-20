/**
 * AFC-486 contract tests — hardening: retention/consent automation, cost
 * reporting, dedupe, monitoring, runbook (ADR-0010 decision 4).
 *
 * Pure node:test, no dependencies. Node's type stripping lets the test
 * import the real TypeScript module, so these assertions pin the route
 * layer rather than a mirror of it:
 *  1. STOP parsing: STOP suppresses the channel, STOP ALL suppresses every
 *     channel; the withdrawal is recorded with a reason (US-N3 AC3, §3.3).
 *  2. Identity: hashes only — canonical digits, stable pre-image, SHA-256
 *     hex; no raw phone past the hash boundary (no-PII posture, 0014-style).
 *  3. Cost: estimate = audience × unit (US-C2 AC1); NULL rate raises (unset
 *     is not zero); only area staff publish the card (owner = area admin).
 *  4. Dedupe: warning starts pending; terminal states need decider + reason;
 *     nothing here merges — the route writes review rows only (US-N1 AC4).
 *  5. Monitoring: tick SLO predicate (five-minute window), SLO ratio over
 *     the log, queue-depth triage, Telegram alert with ids + counts only.
 *  6. Wiring: the opt-out/dedupe/cost/status routes enforce the documented
 *     grants; the Flows schedule the jobs with no new service/secret; the
 *     migration owns four tables, mints no roles, and refuses rollback
 *     while rows exist.
 *
 * Run: node --test tests/web/hardening.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  parseStopRequest,
  suppressionChannelFor,
  canonicalPhoneDigits,
  identityPreimage,
  identityHash,
  estimateRunCost,
  canPublishRates,
  buildDuplicateWarning,
  validateDuplicateDecision,
  tickSloMet,
  tickSloRatio,
  tickSloPassing,
  queueDepthState,
  hardeningAlert,
  isKnownExclusionReason,
  TICK_SLO_MINUTES,
  TICK_SLO_RATIO,
  MONITOR_CHECK_KEYS,
  EXCLUSION_REASONS,
  HARDENING_COLLECTIONS,
} from '../../apps/web/server/utils/hardening.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const util = read('apps/web/server/utils/hardening.ts')
const statusRoute = read('apps/web/server/api/hardening/status.get.ts')
const costGet = read('apps/web/server/api/hardening/cost-rates.get.ts')
const costPost = read('apps/web/server/api/hardening/cost-rates.post.ts')
const duplicates = read('apps/web/server/api/hardening/duplicates.post.ts')
const optOut = read('apps/web/server/api/communications/opt-out.post.ts')
const migration = read('services/directus/schema/migrations/20261020_0015_hardening.sql')
const rollback = read('services/directus/schema/migrations/rollback/20261020_0015_hardening.down.sql')
const retentionFlow = JSON.parse(read('services/directus/flows/retention_consent_automation.json'))
const monitorFlow = JSON.parse(read('services/directus/flows/hardening_monitoring.json'))

describe('STOP / consent withdrawal (US-N3 AC3)', () => {
  it('parses STOP and STOP ALL distinctly', () => {
    assert.deepEqual(parseStopRequest('STOP'), { isStop: true, allChannels: false })
    assert.deepEqual(parseStopRequest('STOP ALL'), { isStop: true, allChannels: true })
    assert.deepEqual(parseStopRequest('please stop all messages'), { isStop: true, allChannels: true })
    assert.deepEqual(parseStopRequest('hello, see you Sunday'), { isStop: false, allChannels: false })
    assert.deepEqual(parseStopRequest(''), { isStop: false, allChannels: false })
  })

  it('maps STOP ALL to the every-channel suppression', () => {
    assert.equal(suppressionChannelFor('sms', true), 'all')
    assert.equal(suppressionChannelFor('sms', false), 'sms')
    assert.equal(suppressionChannelFor('whatsapp', false), 'whatsapp')
  })

  it('records the withdrawal through the communications create grant, never raw phone', () => {
    assert.match(optOut, /requireCan\(scope, 'communications', 'create'\)/)
    assert.match(optOut, /contact_hash/)
    assert.doesNotMatch(optOut, /contact_value/)
    assert.match(optOut, /opt_out_stop/)
  })
})

describe('identity is hash-only past the boundary', () => {
  it('canonicalises phone digits so spellings hash alike', () => {
    assert.equal(canonicalPhoneDigits('+234 803 123-4567'), '2348031234567')
    assert.equal(canonicalPhoneDigits('0803 123 4567'), '08031234567')
  })

  it('builds a stable normalised pre-image', () => {
    const a = identityPreimage({ name: 'Adaeze Okafor', phone: '+2348031234567', email: 'Ada@Example.com' })
    const b = identityPreimage({ name: '  adaeze   okafor ', phone: '2348031234567', email: 'ada@example.com' })
    assert.equal(a, b)
  })

  it('hashes to SHA-256 hex (64 chars), stable per input', async () => {
    const parts = { name: 'Adaeze Okafor', phone: '08031234567', email: '' }
    const first = await identityHash(parts)
    const second = await identityHash(parts)
    assert.equal(first, second)
    assert.match(first, /^[0-9a-f]{64}$/)
  })
})

describe('cost reporting (US-C2 AC1, owner = area admin)', () => {
  it('estimates audience times unit cost', () => {
    assert.equal(estimateRunCost(200, 4.5), 900)
    assert.equal(estimateRunCost(0, 4.5), 0)
  })

  it('refuses to price an unset or negative rate', () => {
    assert.throws(() => estimateRunCost(200, null), /unset/)
    assert.throws(() => estimateRunCost(200, -0.01), /non-negative/)
    assert.throws(() => estimateRunCost(-1, 4.5), /non-negative/)
  })

  it('restricts rate publication to area staff', () => {
    assert.equal(canPublishRates('area_admin'), true)
    assert.equal(canPublishRates('super_admin'), true)
    assert.equal(canPublishRates('branch_admin'), false)
    assert.equal(canPublishRates('member'), false)
    assert.match(costPost, /cost_owner_area_admin/)
  })
})

describe('dedupe warning, never silent auto-merge (US-N1 AC4)', () => {
  it('raises a pending warning, never a decision', () => {
    const warning = buildDuplicateWarning({ contactHash: 'abc123', personA: 'p1', personB: 'p2', branch: 'b1' })
    assert.equal(warning.status, 'pending')
    assert.equal(warning.contact_hash, 'abc123')
  })

  it('rejects degenerate warnings', () => {
    assert.throws(() => buildDuplicateWarning({ contactHash: '', personA: 'p1' }), /contact hash/)
    assert.throws(
      () => buildDuplicateWarning({ contactHash: 'abc', personA: 'p1', personB: 'p1' }),
      /two distinct/,
    )
  })

  it('requires decider + reason for terminal states, forbids them when pending', () => {
    validateDuplicateDecision({ status: 'pending' })
    assert.throws(
      () => validateDuplicateDecision({ status: 'merged' }),
      /decider and a reason/,
    )
    assert.throws(
      () => validateDuplicateDecision({ status: 'kept_separate', decidedBy: 'u1' }),
      /decider and a reason/,
    )
    assert.throws(
      () => validateDuplicateDecision({ status: 'pending', decidedBy: 'u1', reason: 'x' }),
      /no decision/,
    )
    assert.throws(() => validateDuplicateDecision({ status: 'auto_merged' }), /unknown duplicate status/)
    validateDuplicateDecision({ status: 'merged', decidedBy: 'u1', reason: 'same person, two spellings' })
  })

  it('writes review rows only — never a person row — behind people grants', () => {
    assert.match(duplicates, /requireCan\(scope, 'people', 'read'\)/)
    assert.match(duplicates, /requireCan\(scope, 'people', 'update'\)/)
    assert.doesNotMatch(duplicates, /\/items\/people/)
    assert.match(duplicates, /HARDENING_COLLECTIONS\.duplicateReviews/)
  })
})

describe('monitoring (ADR-0009 consequences)', () => {
  it('pins the five-minute tick SLO constants', () => {
    assert.equal(TICK_SLO_MINUTES, 5)
    assert.equal(TICK_SLO_RATIO, 0.99)
  })

  it('meets the SLO inside five minutes, misses it after', () => {
    const window = new Date('2026-10-20T08:00:00Z')
    assert.equal(tickSloMet(window, new Date('2026-10-20T08:04:59Z')), true)
    assert.equal(tickSloMet(window, new Date('2026-10-20T08:05:01Z')), false)
  })

  it('measures the SLO share over the log, never in one row', () => {
    assert.equal(tickSloRatio(99, 100), 0.99)
    assert.equal(tickSloRatio(0, 0), null)
    assert.equal(tickSloPassing(99, 100), true)
    assert.equal(tickSloPassing(98, 100), false)
    assert.equal(tickSloPassing(0, 0), null)
  })

  it('triages queue depth', () => {
    assert.equal(queueDepthState(3, 50, 200), 'ok')
    assert.equal(queueDepthState(50, 50, 200), 'warn')
    assert.equal(queueDepthState(200, 50, 200), 'exceeded')
  })

  it('alerts with ids + counts only, never message content', () => {
    const alert = hardeningAlert({
      kind: 'tick_slo',
      checkKey: 'tick_slo',
      counts: { met: 98, total: 100 },
      note: 'run=r7 window=2026-10-20T08:00Z',
    })
    assert.match(alert.title, /tick_slo/)
    assert.match(alert.body, /met=98 total=100/)
    for (const row of [alert.title, alert.body]) {
      assert.doesNotMatch(row, /rendered|contact_value|message_text/i)
    }
    const payload = JSON.stringify(alert)
    assert.doesNotMatch(payload, /contact_value|rendered_text|message_text/)
  })

  it('accepts only the allowlisted exclusion reasons', () => {
    for (const reason of EXCLUSION_REASONS) assert.equal(isKnownExclusionReason(reason), true)
    assert.equal(isKnownExclusionReason('past_due'), false)
    assert.equal(isKnownExclusionReason(''), false)
  })

  it('covers all six checks', () => {
    assert.deepEqual([...MONITOR_CHECK_KEYS], [
      'endpoint_health',
      'schedule_health',
      'queue_depth',
      'tick_slo',
      'exclusions_audit',
      'pause_drill',
    ])
  })

  it('status route tolerates missing tables instead of 500ing', () => {
    assert.match(statusRoute, /pending_migration_0015/)
    assert.match(statusRoute, /requireCan\(scope, 'communications', 'read'\)/)
    assert.match(statusRoute, /tick_slo_ratio/)
  })
})

describe('Flow wiring (ADR-0010 decision 4: no new service)', () => {
  it('schedules retention + consent automation with the engine named', () => {
    assert.equal(retentionFlow.trigger.type, 'schedule')
    assert.match(retentionFlow.retentionWindow.engine, /retention\.run/)
    assert.match(retentionFlow.retentionWindow.windowSource, /retention_policies/)
    assert.equal(retentionFlow.retentionWindow.dryRunFirst, true)
    const stepIds = retentionFlow.steps.map((s) => s.id)
    assert.ok(stepIds.includes('stop'))
    assert.ok(stepIds.includes('enforce'))
  })

  it('schedules monitoring with pause-all documented', () => {
    assert.equal(monitorFlow.trigger.type, 'schedule')
    const keys = monitorFlow.monitoringChecks.map((c) => c.key)
    for (const key of MONITOR_CHECK_KEYS) assert.ok(keys.includes(key))
    assert.match(monitorFlow.pauseAll, /pause-all/)
    assert.match(monitorFlow.telegramAlert.never, /message content/)
  })

  it('both Flows declare no new service, secret, or dependency', () => {
    for (const flow of [retentionFlow, monitorFlow]) {
      const text = JSON.stringify(flow)
      assert.match(text, /[Nn]o new service/)
    }
  })

  it('Flow files exist on disk', () => {
    assert.equal(existsSync(path.join(root, 'services/directus/flows/retention_consent_automation.json')), true)
    assert.equal(existsSync(path.join(root, 'services/directus/flows/hardening_monitoring.json')), true)
  })
})

describe('migration shape (0015)', () => {
  it('creates the four hardening tables and nothing else', () => {
    for (const table of [
      'communication_suppressions',
      'campaign_cost_rates',
      'person_duplicate_reviews',
      'hardening_monitor_checks',
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
    }
    assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS (people|communications|campaign_runs)\b/)
  })

  it('mints no roles and grants no role-creation capability', () => {
    assert.doesNotMatch(migration, /CREATE\s+ROLE/i)
    assert.doesNotMatch(migration, /GRANT\s+[^\n]*\b(CREATEROLE|SUPERUSER)\b/i)
    assert.doesNotMatch(migration, /ALTER\s+ROLE[^\n]*\bSUPERUSER\b/i)
    assert.match(migration, /GRANT SELECT.*TO directus_app/)
    assert.match(migration, /REVOKE ALL .* FROM PUBLIC/)
  })

  it('refuses rollback while any hardening table holds rows', () => {
    assert.match(rollback, /communication_suppressions/)
    assert.match(rollback, /restrict_violation/)
    assert.match(rollback, /DROP TABLE IF EXISTS hardening_monitor_checks/)
  })

  it('names the collections the routes use', () => {
    assert.equal(HARDENING_COLLECTIONS.suppressions, 'communication_suppressions')
    assert.equal(HARDENING_COLLECTIONS.costRates, 'campaign_cost_rates')
    assert.equal(HARDENING_COLLECTIONS.duplicateReviews, 'person_duplicate_reviews')
    assert.equal(HARDENING_COLLECTIONS.monitorChecks, 'hardening_monitor_checks')
  })
})

describe('retention-gate hygiene', () => {
  it('names no retention period in the scanned util', () => {
    assert.doesNotMatch(util, /['"]\s*[0-9]+\s+(days?|weeks?|months?|years?)\s*['"]/i)
    assert.doesNotMatch(util, /make_interval\s*\(\s*(years|months|weeks|days)\s*=>\s*[0-9]+/)
    assert.doesNotMatch(util, /RETENTION_[A-Z_]*(DAYS|SECONDS?)\s*[:=]\s*[0-9]{2,}/)
  })
})
