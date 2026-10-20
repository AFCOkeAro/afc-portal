/**
 * AFC-479 contract tests — delivery-log read surface + redaction.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Both routes require the communications read grant and scope to the
 *     caller's branches (no unscoped reads).
 *  2. The list route projects counts only: it never requests contact_value,
 *     error_detail or provider_message_id from Directus.
 *  3. The detail route requests recipient rows through visibleFields and
 *     strips them through stripHiddenMany, so non-staff scopes never see
 *     internals (data-model-v4 §5.1).
 *  4. The shared matrix hides exactly the three internals from every role
 *     below branch admin, and the redaction keeps status, consent basis and
 *     exclusion reason visible (an excluded recipient with no visible reason
 *     is unactionable).
 *  5. The migration this surface reads encodes the acceptance rule: a send
 *     state always carries a real basis, an excluded row always carries a
 *     reason with basis none.
 *
 * Run: node --test tests/web/communications-delivery-log.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

/** Mirrors `stripHidden`: drop exactly the hidden fields, keep everything else. */
function redact(row, hidden) {
  return Object.fromEntries(
    Object.entries(row).filter(([field]) => !hidden.includes(field)),
  )
}

// Grates transcribed from the §5 matrix for the two contract roles. The
// volunteer holds no communications grant at all; the branch admin holds
// own-branch reads on both collections with no hidden recipient fields.
const BRANCH_ADMIN = {
  can: (collection, action) =>
    (collection === 'communications' &&
      (action === 'create' || action === 'read' || action === 'update')) ||
    (collection === 'communication_recipients' && action === 'read'),
  hidden: [],
}
const VOLUNTEER = {
  can: () => false,
  hidden: ['contact_value', 'error_detail', 'provider_message_id'],
}

const EXCLUDED_ROW = {
  id: 'r1',
  communication: 'c1',
  contact_value: '+2348012345678',
  contact_hash: 'hash:abc',
  channel: 'sms',
  consent_basis: 'none',
  message_rendered: null,
  status: 'excluded',
  exclusion_reason: 'no_consent',
  provider_message_id: null,
  error_detail: null,
  sent_at: null,
}

const FAILED_ROW = {
  id: 'r2',
  communication: 'c1',
  contact_value: '+2348098765432',
  contact_hash: 'hash:def',
  channel: 'whatsapp',
  consent_basis: 'explicit_opt_in',
  message_rendered: 'frozen text',
  status: 'failed',
  exclusion_reason: null,
  provider_message_id: 'prov-1',
  error_detail: 'provider timeout',
  sent_at: '2026-10-20T08:00:00Z',
}

describe('delivery-log list route', () => {
  const source = read('apps/web/server/api/communications/index.get.ts')

  it('requires the communications read grant', () => {
    assert.match(source, /requireCan\(scope, 'communications', 'read'\)/)
  })

  it('scopes the header query to the caller branches', () => {
    assert.match(source, /scopeFilter\(scope\)/)
  })

  it('projects counts only and never requests recipient internals', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    assert.match(code, /fields: \['communication', 'status', 'exclusion_reason'\]/)
    assert.doesNotMatch(code, /contact_value/)
    assert.doesNotMatch(code, /error_detail/)
    assert.doesNotMatch(code, /provider_message_id/)
  })

  it('returns a null count block rather than a partial one for roles without the recipient grant', () => {
    assert.match(source, /recipient_counts: countsById\.get\(.*\) \?\? null/)
    assert.match(source, /can\(scope, 'communication_recipients', 'read'\)/)
  })
})

describe('delivery-log detail route', () => {
  const source = read('apps/web/server/api/communications/[id].get.ts')

  it('requires the communications read grant and scopes the header', () => {
    assert.match(source, /requireCan\(scope, 'communications', 'read'\)/)
    assert.match(source, /findScopedItem/)
  })

  it('reads recipients through visibleFields and strips through stripHiddenMany', () => {
    assert.match(
      source,
      /visibleFields\(scope, 'communication_recipients', RECIPIENT_FIELDS\)/,
    )
    assert.match(
      source,
      /stripHiddenMany\(\s*scope,\s*'communication_recipients',\s*result\.data/,
    )
  })

  it('withholds recipient rows entirely from roles without the grant', () => {
    assert.match(source, /let recipients.*= null/)
    assert.match(source, /if \(can\(scope, 'communication_recipients', 'read'\)\)/)
  })
})

describe('redaction keeps the actionable fields', () => {
  it('branch admin sees the full excluded row', () => {
    const row = redact(EXCLUDED_ROW, BRANCH_ADMIN.hidden)
    assert.equal(row.contact_value, '+2348012345678')
    assert.equal(row.exclusion_reason, 'no_consent')
    assert.equal(row.consent_basis, 'none')
  })

  it('below branch admin the internals are gone but status, basis and reason stay', () => {
    const row = redact(EXCLUDED_ROW, VOLUNTEER.hidden)
    assert.equal(row.contact_value, undefined)
    assert.equal(row.error_detail, undefined)
    assert.equal(row.provider_message_id, undefined)
    assert.equal(row.status, 'excluded')
    assert.equal(row.consent_basis, 'none')
    assert.equal(row.exclusion_reason, 'no_consent')
    assert.equal(row.contact_hash, 'hash:abc')
  })

  it('below branch admin a failed row keeps its basis but loses provider detail', () => {
    const row = redact(FAILED_ROW, VOLUNTEER.hidden)
    assert.equal(row.status, 'failed')
    assert.equal(row.consent_basis, 'explicit_opt_in')
    assert.equal(row.message_rendered, 'frozen text')
    assert.equal(row.error_detail, undefined)
    assert.equal(row.provider_message_id, undefined)
  })

  it('the shared matrix hides exactly the three internals below branch admin', () => {
    const matrix = read('packages/shared/src/role-matrix.ts')
    assert.match(
      matrix,
      /\[COLLECTIONS\.communicationRecipients\]: \{\s*\n\s*fields: \['contact_value', 'error_detail', 'provider_message_id'\]/,
    )
    assert.match(matrix, /roles: \['super_admin', 'area_admin', 'branch_admin'\]/)
  })
})

describe('migration encodes the acceptance rule this surface reads', () => {
  const migration = read(
    'services/directus/schema/migrations/20261020_0004_comms_consent.sql',
  )

  it('send states always carry a real basis; excluded rows carry basis none plus a reason', () => {
    assert.match(migration, /comms_recipient_basis_matches_status/)
    assert.match(migration, /consent_basis <> 'none'/)
    assert.match(migration, /exclusion_reason IS NOT NULL/)
  })

  it('ships the audience-time resolver with no staff override', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION comms_resolve_consent\(/)
    const signature = migration.match(
      /CREATE OR REPLACE FUNCTION comms_resolve_consent\(([\s\S]*?)\)\s*\nRETURNS TABLE/,
    )
    assert.ok(signature, 'resolver signature found')
    assert.doesNotMatch(signature[1], /override/)
  })

  it('seeds the §2 template keys as pending_provider and owns a down script', () => {
    for (const key of [
      'visitor_welcome_wa',
      'event_invitation',
      'whatsapp_fallback_sms',
    ]) {
      assert.ok(migration.includes(`'${key}'`), `seed key ${key} present`)
    }
    assert.match(migration, /pending_provider/)
    const down = read(
      'services/directus/schema/migrations/rollback/20261020_0004_comms_consent.down.sql',
    )
    assert.match(down, /DROP TABLE IF EXISTS communication_recipients/)
  })
})
