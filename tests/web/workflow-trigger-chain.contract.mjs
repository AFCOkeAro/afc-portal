/**
 * AFC-868 contract tests — workflow trigger-chain preview surface
 * (Upon Joining a Group sample).
 *
 * Pure node:test, no dependencies. The builder half imports the real
 * TypeScript module (Node type stripping), so these assertions pin the
 * worker-half reuse rather than a mirror of it:
 *  1. Route: gated on the communications read grant, branch-scoped, and
 *     read-only (no create/update/delete, no send, no enqueue). Enrollments,
 *     contacts and recipient internals are never selected.
 *  2. Failure shape: unreadable store fails named (campaign_store / 0006),
 *     never bare 500; an unknown campaign key is a 404 with a stable code.
 *  3. Builder: wait-day parsing renders the sample spine (Wait 0 / 0 / 1 /
 *     2 Days), channel icons map per the contract, weekday pills derive
 *     from the anchor, status dots reuse the tick hold/template gates, and
 *     consent + quiet-hours notes reuse the shared rules.
 *  4. Component + page: purple trigger pill, vertical dotted spine,
 *     wait-then-send cards with channel icon / day pill / status dot;
 *     read-only with builder editing deferred to AFC-586.
 *
 * Run: node --test tests/web/workflow-trigger-chain.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { register } from 'node:module'

// Portal source uses extensionless relative imports; this hook maps the
// single campaign-tick specifier so the builder import below resolves the
// real module under type stripping.
register(
  pathToFileURL(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'trigger-chain-resolve-hook.mjs',
    ),
  ),
)

const {
  buildTriggerChain,
  channelIconFor,
  consentNoteFor,
  lagosDayPill,
  quietHoursNoteFor,
  scheduledAtFor,
  waitDaysFromDelay,
  waitLabelFor,
  nodeStatusFor,
  TRIGGER_UPON_JOINING_GROUP,
} = await import('../../apps/web/server/utils/trigger-chain.ts')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const stepRow = (overrides = {}) => ({
  sequence: 1,
  name: 'Welcome message',
  delay_type: 'delay_days',
  delay_value: '0',
  channel_key: 'sms',
  channel_enabled: true,
  template_approval_status: null,
  template_provider_id: null,
  is_entry_step: true,
  active: true,
  ...overrides,
})

const chainInput = (overrides = {}) => ({
  campaign_key: 'new_visitor_welcome_drip',
  campaign_name: 'New-visitor welcome drip',
  consent_policy: 'marketing_only',
  campaign_status: 'active',
  quiet_hours_override: false,
  steps: [stepRow()],
  anchor: new Date('2026-10-26T09:00:00Z'),
  ...overrides,
})

describe('trigger-chain route: gated, scoped, read-only', () => {
  const src = codeOf('apps/web/server/api/workflows/trigger-chain.get.ts')

  it('requires the communications read grant (no new capability invented)', () => {
    assert.match(src, /requireCan\(scope, 'communications', 'read'\)/)
  })

  it('scopes branch staff to own branches plus area-wide rows', () => {
    assert.match(src, /\{ branch: \{ _in: scope\.branchIds \} \}/)
    assert.match(src, /\{ branch: \{ _null: true \} \}/)
  })

  it('never selects enrollments, contacts or recipient internals', () => {
    assert.doesNotMatch(src, /campaign_enrollments/)
    assert.doesNotMatch(src, /contact_key/)
    assert.doesNotMatch(src, /contact_value/)
    assert.doesNotMatch(src, /communication_recipients/)
  })

  it('writes nothing and enqueues nothing', () => {
    assert.doesNotMatch(src, /createItem\(/)
    assert.doesNotMatch(src, /updateItem\(/)
    assert.doesNotMatch(src, /deleteItem\(/)
    assert.doesNotMatch(src, /internal\/send/)
    assert.doesNotMatch(src, /status: 'paused'/)
  })

  it('resolves one campaign by key and lists steps in sequence order', () => {
    assert.match(src, /key: \{ _eq: key \}/)
    assert.match(src, /campaign_steps/)
    assert.match(src, /sort: 'sequence'/)
  })
})

describe('trigger-chain route: named failure shape, never bare 500', () => {
  const src = codeOf('apps/web/server/api/workflows/trigger-chain.get.ts')
  const portal = codeOf('apps/web/server/utils/portal.ts')

  it('portal maps a refused read to 403 and a missing store to 503', () => {
    assert.match(portal, /throwStoreUnavailable/)
    assert.match(portal, /DirectusAuthError/)
    assert.match(portal, /statusCode: 403/)
    assert.match(portal, /statusCode: 503/)
  })

  it('wraps the campaign/step reads in the named store error', () => {
    assert.match(src, /throwStoreUnavailable\(error, 'campaign_store', '0006'\)/)
    assert.match(src, /catch \(error\)/)
  })

  it('unknown campaign key is a 404 with a stable code', () => {
    assert.match(src, /statusCode: 404/)
    assert.match(src, /trigger_chain_unknown_campaign/)
  })

  it('channel/template enrichment degrades instead of 500ing', () => {
    assert.match(src, /\.catch\(\(\) => null\)/)
  })
})

describe('builder: wait spine matches the sample (0 / 0 / 1 / 2)', () => {
  it('parses immediate and day/hour delays to whole days', () => {
    assert.equal(waitDaysFromDelay('immediate', null), 0)
    assert.equal(waitDaysFromDelay('delay_days', '0'), 0)
    assert.equal(waitDaysFromDelay('delay_days', '2'), 2)
    assert.equal(waitDaysFromDelay('delay_days', 'not-a-number'), 0)
    assert.equal(waitDaysFromDelay('delay_hours', '12'), 0)
    assert.equal(waitDaysFromDelay('delay_hours', '48'), 2)
  })

  it('event and cron steps carry no day count', () => {
    assert.equal(waitDaysFromDelay('weekly_cron', null), null)
    assert.equal(waitDaysFromDelay('wait_for_event', null), null)
  })

  it('labels the sample cards Wait 0 / 1 / 2 Days', () => {
    assert.equal(waitLabelFor(0, 'delay_days'), 'Wait 0 Days')
    assert.equal(waitLabelFor(1, 'delay_days'), 'Wait 1 Day')
    assert.equal(waitLabelFor(2, 'delay_days'), 'Wait 2 Days')
    assert.equal(waitLabelFor(null, 'weekly_cron'), 'Weekly send')
    assert.equal(waitLabelFor(null, 'wait_for_event'), 'Wait for event')
  })

  it('maps channel keys to the sample icon set', () => {
    assert.equal(channelIconFor('sms', 'delay_days'), 'sms')
    assert.equal(channelIconFor('email', 'delay_days'), 'email')
    assert.equal(channelIconFor('whatsapp', 'delay_days'), 'chat')
    assert.equal(channelIconFor('sms', 'weekly_cron'), 'sms')
  })

  it('builds the four-node sample chain from step rows', () => {
    const chain = buildTriggerChain(
      chainInput({
        steps: [
          stepRow({ sequence: 1, delay_value: '0', channel_key: 'sms' }),
          stepRow({
            sequence: 2,
            delay_value: '0',
            channel_key: 'email',
            is_entry_step: false,
          }),
          stepRow({
            sequence: 3,
            delay_value: '1',
            channel_key: 'whatsapp',
            is_entry_step: false,
            template_approval_status: 'approved',
            template_provider_id: 'tpl-1',
          }),
          stepRow({
            sequence: 4,
            delay_value: '2',
            channel_key: 'sms',
            is_entry_step: false,
          }),
        ],
      }),
    )
    assert.equal(chain.trigger, TRIGGER_UPON_JOINING_GROUP)
    assert.match(chain.trigger_label, /Upon Joining a Group/)
    assert.equal(chain.node_count, 4)
    assert.deepEqual(
      chain.nodes.map((n) => n.wait_label),
      ['Wait 0 Days', 'Wait 0 Days', 'Wait 1 Day', 'Wait 2 Days'],
    )
    for (const node of chain.nodes) {
      assert.match(node.day_pill ?? '', /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
      assert.ok(node.scheduled_at)
    }
  })
})

describe('builder: status dots and notes reuse the shared rules', () => {
  const src = read('apps/web/server/utils/trigger-chain.ts')

  it('imports the tick gates instead of restating them', () => {
    assert.match(src, /from '.\/campaign-tick'/)
    assert.match(src, /shiftQuietHours/)
    assert.match(src, /tickHold/)
    assert.match(src, /templateAllowed/)
    assert.match(src, /QUIET_START_HOUR/)
    assert.match(src, /QUIET_END_HOUR/)
  })

  it('marks sendable steps green and held/blocked steps red', () => {
    assert.equal(
      nodeStatusFor({
        campaign_status: 'active',
        channel_key: 'sms',
        channel_enabled: true,
        template_approval_status: null,
        template_provider_id: null,
        active: true,
      }).status,
      'sendable',
    )
    const held = nodeStatusFor({
      campaign_status: 'paused',
      channel_key: 'sms',
      channel_enabled: true,
      template_approval_status: null,
      template_provider_id: null,
      active: true,
    })
    assert.equal(held.status, 'held')
    assert.equal(held.reason, 'campaign_paused')
    const blocked = nodeStatusFor({
      campaign_status: 'active',
      channel_key: 'whatsapp',
      channel_enabled: true,
      template_approval_status: 'draft',
      template_provider_id: null,
      active: true,
    })
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.reason, 'template_not_approved')
  })

  it('never hides an inactive step — it renders blocked', () => {
    const chain = buildTriggerChain(chainInput({ steps: [stepRow({ active: false })] }))
    assert.equal(chain.nodes.length, 1)
    assert.equal(chain.nodes[0].status, 'blocked')
  })

  it('shifts quiet-hour sends and says so on the card', () => {
    // 22:00 UTC is 23:00 Lagos — inside the quiet window.
    const raw = new Date('2026-10-26T22:00:00Z')
    const shifted = scheduledAtFor(raw, 0, false)
    assert.ok(shifted.getTime() > raw.getTime())
    assert.match(quietHoursNoteFor(raw, shifted, false), /quiet-hours/i)
    assert.match(quietHoursNoteFor(raw, shifted, false), /Lagos/)
    const essential = scheduledAtFor(raw, 0, true)
    assert.equal(essential.getTime(), raw.getTime())
  })

  it('states the consent basis per policy without inventing counts', () => {
    assert.match(consentNoteFor('marketing_only'), /marketing consent/)
    assert.match(consentNoteFor('operational_essential'), /Operational-essential/)
    assert.match(consentNoteFor('mixed'), /Mixed/)
    const chain = buildTriggerChain(chainInput({}))
    assert.ok(chain.nodes[0].consent_note.length > 0)
    assert.doesNotMatch(chain.nodes[0].consent_note, /[0-9]+ (eligible|excluded)/)
  })

  it('derives weekday pills in Lagos wall-clock', () => {
    assert.equal(lagosDayPill(new Date('2026-10-26T09:00:00Z')), 'Mon')
  })
})

describe('component: sample visual elements, read-only', () => {
  const src = codeOf('apps/web/components/WorkflowTriggerChain.vue')

  it('renders the purple trigger pill with the trigger name', () => {
    assert.match(src, /bg-purple-600/)
    assert.match(src, /trigger_label/)
    assert.match(src, /i-lucide-workflow/)
  })

  it('renders the vertical dotted spine with one card per node', () => {
    assert.match(src, /border-dotted/)
    assert.match(src, /trigger-chain-node/)
    assert.match(src, /wait_label/)
  })

  it('shows channel icon, day pill and status dot per card', () => {
    assert.match(src, /day_pill/)
    assert.match(src, /statusDotClass|status-dot|statusText/)
    assert.match(src, /bg-green-500/)
    assert.match(src, /bg-red-500/)
  })

  it('fetches nothing and offers no editing', () => {
    assert.doesNotMatch(src, /useApi\(\)/)
    assert.doesNotMatch(src, /\$fetch/)
    assert.doesNotMatch(src, /createItem/)
    assert.doesNotMatch(src, /editable|contenteditable/)
  })
})

describe('page + navigation: read-only surface, builder deferred', () => {
  const page = codeOf('apps/web/pages/workflows/index.vue')
  const nav = codeOf('apps/web/utils/navigation.ts')

  it('gates the page behind staff middleware and the read grant', () => {
    assert.match(page, /middleware: 'staff'/)
    assert.match(page, /PermissionGate/)
    assert.match(page, /communications/)
  })

  it('fetches the preview route with a key and an anchor date', () => {
    assert.match(page, /\/api\/workflows\/trigger-chain/)
    assert.match(page, /anchor/)
  })

  it('states the preview is not a scheduled run and editing is out of scope', () => {
    assert.match(page, /read-only|Read-only/)
    assert.match(page, /AFC-586/)
    assert.match(page, /Not a scheduled run|not a scheduled run/)
  })

  it('registers the Workflows entry under communications', () => {
    assert.match(nav, /label: 'Workflows'/)
    assert.match(nav, /to: '\/workflows'/)
    assert.match(nav, /group: 'communications'/)
  })
})
