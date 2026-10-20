/**
 * AFC-527 contract tests — campaign read surface (catalogue / detail / run).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. All three routes require the communications read grant and scope to the
 *     caller's branches (area-wide rows visible to branch staff, enrollments
 *     never selected).
 *  2. The surface is read-only: no create/update/delete, no send, no enqueue,
 *     no pause/resume. The kill switch stays POST /api/hardening/pause-all.
 *  3. The catalogue reports step counts + the latest run per campaign.
 *  4. The detail resolves step channel keys + template approval state
 *     (US-C1 AC4 gate display) and reports the consent-gate preview from the
 *     latest stored run (never invented numbers before the first run).
 *  5. The run report carries the auditable counters + signal-availability
 *     notes (screen 12) and refuses runs of another campaign (404).
 *  6. The migration seeds the nine campaign keys this catalogue lists.
 *
 * Run: node --test tests/web/campaign-reads.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const EXPECTED_KEYS = [
  'whatsapp_sms_fallback',
  'newcomer_weekly_checkin',
  'birthday_anniversary_greeting',
  'new_visitor_welcome_drip',
  'new_convert_drip',
  'weekly_memory_verse',
  'service_reminder',
  'meeting_reminder',
  'event_invitation',
]

describe('campaign list route: gated, scoped, read-only', () => {
  const src = codeOf('apps/web/server/api/campaigns/index.get.ts')

  it('requires the communications read grant (no new capability invented)', () => {
    assert.match(src, /requireCan\(scope, 'communications', 'read'\)/)
  })

  it('scopes branch staff to own branches plus area-wide rows', () => {
    assert.match(src, /\{ branch: \{ _in: scope\.branchIds \} \}/)
    assert.match(src, /\{ branch: \{ _null: true \} \}/)
  })

  it('never selects enrollments (contact_key is area/super reads only)', () => {
    assert.doesNotMatch(src, /campaign_enrollments/)
    assert.doesNotMatch(src, /contact_key/)
  })

  it('writes nothing and enqueues nothing', () => {
    assert.doesNotMatch(src, /createItem\(/)
    assert.doesNotMatch(src, /updateItem\(/)
    assert.doesNotMatch(src, /deleteItem\(/)
    assert.doesNotMatch(src, /internal\/send/)
    assert.doesNotMatch(src, /status: 'paused'/)
  })

  it('reports step counts and the latest run per campaign', () => {
    assert.match(src, /step_count/)
    assert.match(src, /last_run/)
    assert.match(src, /sort: '-window_start'/)
  })
})

describe('campaign detail route: steps, gate state, stored preview', () => {
  const src = codeOf('apps/web/server/api/campaigns/[id].get.ts')

  it('requires the communications read grant and scopes via the campaign', () => {
    assert.match(src, /requireCan\(scope, 'communications', 'read'\)/)
    assert.match(src, /findScopedItem/)
    assert.match(src, /\{ branch: \{ _null: true \} \}/)
  })

  it('lists steps in sequence order', () => {
    assert.match(src, /campaign_steps/)
    assert.match(src, /sort: 'sequence'/)
  })

  it('resolves channel keys and template approval state (US-C1 AC4)', () => {
    assert.match(src, /channel_key/)
    assert.match(src, /template_approval_status/)
    assert.match(src, /approval_status/)
    assert.match(src, /provider_template_id/)
  })

  it('reports the consent-gate preview from the latest stored run only', () => {
    assert.match(src, /consent_gate_preview/)
    assert.match(src, /eligible_count/)
    assert.match(src, /excluded_reasons/)
    assert.match(src, /has_run: false/)
  })

  it('writes nothing and enqueues nothing', () => {
    assert.doesNotMatch(src, /createItem/)
    assert.doesNotMatch(src, /updateItem/)
    assert.doesNotMatch(src, /deleteItem/)
    assert.doesNotMatch(src, /internal\/send/)
  })
})

describe('campaign run route: auditable report, own campaign only', () => {
  const src = codeOf('apps/web/server/api/campaigns/[id]/runs/[runId].get.ts')

  it('requires the communications read grant', () => {
    assert.match(src, /requireCan\(scope, 'communications', 'read'\)/)
  })

  it('gates scope through the campaign read first', () => {
    const campaignAt = src.indexOf('findScopedItem')
    const runAt = src.indexOf('campaign_runs')
    assert.ok(
      campaignAt >= 0 && runAt > campaignAt,
      'campaign read precedes the run read',
    )
  })

  it('refuses runs that belong to another campaign', () => {
    assert.match(src, /run_campaign_mismatch/)
    assert.match(src, /statusCode: 404/)
  })

  it('carries the screen-12 counters, cost and signal notes', () => {
    for (const field of [
      'audience_size',
      'eligible_count',
      'excluded_count',
      'excluded_reasons',
      'queued_count',
      'sent_count',
      'delivered_count',
      'read_count',
      'failed_count',
      'opted_out_count',
      'estimated_cost',
      'notes',
    ]) {
      assert.ok(src.includes(`'${field}'`), `run field ${field} selected`)
    }
  })

  it('exposes no recipient internals', () => {
    assert.doesNotMatch(src, /contact_value/)
    assert.doesNotMatch(src, /error_detail/)
    assert.doesNotMatch(src, /provider_message_id/)
    assert.doesNotMatch(src, /communication_recipients/)
  })

  it('writes nothing and enqueues nothing', () => {
    assert.doesNotMatch(src, /createItem/)
    assert.doesNotMatch(src, /updateItem/)
    assert.doesNotMatch(src, /deleteItem/)
    assert.doesNotMatch(src, /internal\/send/)
  })
})

describe('campaign routes: unreadable store fails named, never bare 500 (AFC-550)', () => {
  const list = codeOf('apps/web/server/api/campaigns/index.get.ts')
  const detail = codeOf('apps/web/server/api/campaigns/[id].get.ts')
  const run = codeOf('apps/web/server/api/campaigns/[id]/runs/[runId].get.ts')
  const portal = codeOf('apps/web/server/utils/portal.ts')

  it('portal maps a refused read to 403 and a missing store to 503', () => {
    assert.match(portal, /throwStoreUnavailable/)
    assert.match(portal, /DirectusAuthError/)
    assert.match(portal, /statusCode: 403/)
    assert.match(portal, /statusCode: 503/)
    assert.match(portal, /pending_migration_/)
  })

  it('catalogue wraps every 0006 read in the named store error', () => {
    assert.match(list, /throwStoreUnavailable\(error, 'campaign_store', '0006'\)/)
    assert.match(list, /catch \(error\)/)
  })

  it('detail wraps the core 0006 reads in the named store error', () => {
    assert.match(detail, /throwStoreUnavailable\(error, 'campaign_store', '0006'\)/)
  })

  it('detail degrades channel/template enrichment instead of 500ing', () => {
    assert.match(detail, /\.catch\(\(\) => null\)/)
  })

  it('run report wraps the campaign/run reads in the named store error', () => {
    assert.match(run, /throwStoreUnavailable\(error, 'campaign_store', '0006'\)/)
  })
})

describe('migration seeds the nine catalogue keys', () => {
  const migration = read(
    'services/directus/schema/migrations/20261020_0006_campaigns.sql',
  )

  it('seeds every family key the catalogue lists', () => {
    for (const key of EXPECTED_KEYS) {
      assert.ok(migration.includes(`'${key}'`), `seed key ${key} present`)
    }
  })
})
