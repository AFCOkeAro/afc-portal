/**
 * AFC-869 contract tests — New Communication configure step.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. The reachable preview requires the communications read grant and
 *     scopes people to the caller's branches (no unscoped reads, no
 *     out-of-scope branch override).
 *  2. The preview returns counts only: it never selects contact_value,
 *     contact_hash (as a return), provider ids or rendered text — hashes
 *     are used internally for the suppression join and never returned.
 *  3. Resolution mirrors comms_resolve_consent priority (opt-out first,
 *     then validity, then the minor rule, then the grant) and the two
 *     stated mappings: email reuses the SMS grant, bulk requires a grant
 *     while personal behaves as operational-essential.
 *  4. Failure shapes are named, never bare 500s: invalid channel /
 *     classification are 400s with codes; unreadable stores map through
 *     throwStoreUnavailable to 403/503 with pending_migration codes.
 *  5. The configure page gates on the communications create grant, shows
 *     per-medium reachable badges, the personal-vs-bulk classification,
 *     schedule now/later, and leaves template selection visibly future
 *     (no fake send path).
 *
 * Run: node --test tests/web/communications-configure.contract.mjs
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

describe('reachable preview route: gated, scoped, counts-only', () => {
  const src = codeOf('apps/web/server/api/communications/reachable.get.ts')

  it('requires the communications read grant (no new capability invented)', () => {
    assert.match(src, /requireCan\(scope, 'communications', 'read'\)/)
  })

  it('scopes people to the caller branches', () => {
    assert.match(src, /scopeFilter\(scope\)/)
    assert.match(src, /resolveBranch\(scope, query\.branch/)
  })

  it('selects no recipient internals and returns counts only', () => {
    assert.doesNotMatch(src, /contact_value/)
    assert.doesNotMatch(src, /provider_message_id/)
    assert.doesNotMatch(src, /error_detail/)
    assert.doesNotMatch(src, /message_rendered/)
    assert.match(src, /excluded_reasons/)
    assert.match(src, /personal_preference/)
  })

  it('mirrors the resolver priority: opt-out, validity, minor rule, grant', () => {
    const optedAt = src.indexOf("bump(smsReasons, 'opted_out')")
    const validAt = src.indexOf("bump(smsReasons, 'invalid_contact')")
    const minorAt = src.indexOf("bump(smsReasons, 'minor_no_guardian_consent')")
    const grantAt = src.indexOf("bump(smsReasons, 'no_consent')")
    assert.ok(optedAt >= 0 && validAt > optedAt, 'opt-out precedes validity')
    assert.ok(minorAt > validAt, 'minor rule follows validity')
    assert.ok(grantAt > minorAt, 'grant check comes last')
  })

  it('email reuses the SMS grant set; bulk requires a grant (see route header for the stated mappings)', () => {
    const smsGrantUses = src.match(/grantedSms\.has\(id\)/g) ?? []
    assert.ok(
      smsGrantUses.length >= 2,
      'both the SMS and email legs gate on the SMS grant set',
    )
    assert.doesNotMatch(src, /grantedEmail/)
    assert.match(src, /classification === 'bulk' && !grant/)
  })

  it('never writes, enqueues, or sends', () => {
    assert.doesNotMatch(src, /createItem\(/)
    assert.doesNotMatch(src, /updateItem\(/)
    assert.doesNotMatch(src, /deleteItem\(/)
    assert.doesNotMatch(src, /internal\/send/)
  })
})

describe('reachable preview route: named failure shapes', () => {
  const src = codeOf('apps/web/server/api/communications/reachable.get.ts')

  it('rejects an unknown channel with a 400 code', () => {
    assert.match(src, /statusCode: 400/)
    assert.match(src, /code: 'invalid_channel'/)
  })

  it('rejects an unknown classification with a 400 code', () => {
    assert.match(src, /code: 'invalid_classification'/)
  })

  it('maps unreadable stores through the named store error', () => {
    assert.match(src, /throwStoreUnavailable\(error, 'people_store', '0004'\)/)
    assert.match(src, /throwStoreUnavailable\(error, 'consent_store', '0004'\)/)
  })

  it('marks an unverified suppression read instead of failing the count', () => {
    assert.match(src, /suppressions_verified/)
  })
})

describe('configure page: Rock-solid step with gates unchanged', () => {
  const src = read('apps/web/pages/communications/new.vue')

  it('gates composing on the communications create grant', () => {
    assert.match(src, /COLLECTIONS\.communications,\s*'create'/)
  })

  it('renders the configure fields: name, list, topic', () => {
    assert.match(src, /Communication Name/)
    assert.match(src, /Communication List/)
    assert.match(src, /Topic/)
  })

  it('renders the three medium cards with reachable badges', () => {
    assert.match(src, /Reachable Audience/)
    assert.match(src, /Personal Preference/)
  })

  it('renders the personal-vs-bulk classification', () => {
    assert.match(src, /Personal \/ Need-to-Know|Personal.*Need-to-Know/)
    assert.match(src, /Bulk \/ Marketing|Bulk.*Marketing/)
  })

  it('renders schedule now/later with the quiet-hours note', () => {
    assert.match(src, /When to Send|Now.*Later/s)
    assert.match(src, /quiet/i)
  })

  it('surfaces caps and the kill switch from the existing endpoints', () => {
    assert.match(src, /\/api\/hardening\/status/)
    assert.match(src, /\/api\/invites\/quota/)
  })

  it('leaves template selection visibly future with no send path', () => {
    assert.match(src, /Next: Choose Template/)
    assert.doesNotMatch(src, /\/api\/invites['"]/)
    assert.doesNotMatch(src, /createItem/)
  })
})
