/**
 * AFC-639a contract tests — zones fail-closed named 403 + dashboard section
 * isolation (AFC-564 precedent).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. zones.get.ts fails closed: listItems wrapped in try/catch, deliberate
 *     4xx rethrown, DirectusAuthError mapped via throwStoreUnavailable with
 *     the zone store name + owning migration (named 403, never bare 500,
 *     never degraded []).
 *  2. dashboard.get.ts isolates each aggregation section settleSection-style:
 *     single-collection denial yields degraded 200 with named section
 *     warnings, sibling sections intact. Core identity/scope stays
 *     fail-closed (getPortalScope outside any settleSection).
 *
 * Run: node --test tests/web/zones-dashboard-isolation.contract.mjs
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

describe('zones: fail closed with a named 403', () => {
  const src = codeOf('apps/web/server/api/zones.get.ts')

  it('routes Directus failures through throwStoreUnavailable', () => {
    assert.match(src, /throwStoreUnavailable/)
  })

  it('names the zone store and the owning hierarchy migration', () => {
    assert.match(src, /zone_store/)
    assert.match(src, /0002/)
  })

  it('wraps the zone list read in try/catch', () => {
    assert.match(src, /try\s*\{/)
    assert.match(src, /catch\s*\(error\)/)
    assert.match(src, /listItems<ZoneSummary>.*zones/s)
  })

  it('lets deliberate 4xx pass through untouched', () => {
    assert.match(src, /statusCode/)
    assert.match(src, /throw error/)
  })

  it('never degrades to an empty list', () => {
    assert.doesNotMatch(src, /return \[\]/)
    assert.doesNotMatch(src, /settleSection/)
  })
})

describe('dashboard: per-section isolation with named warnings', () => {
  const src = codeOf('apps/web/server/api/dashboard.get.ts')

  it('settles each aggregation section independently (AFC-564 precedent)', () => {
    assert.match(src, /settleSection/)
    assert.match(src, /dashboard section failed/)
  })

  it('isolates the main reads: branches, events, visitors, attendance, welfare', () => {
    for (const section of [
      'branches',
      'upcomingEvents',
      'followUps',
      'attendanceCurrent',
      'attendancePrior',
      'attendanceTrend',
      'welfareCases',
      'peopleSummary',
      'sundayClasses',
      'sundaySessions',
    ]) {
      assert.match(src, new RegExp(`'${section}'`), `section ${section} isolated`)
    }
  })

  it('isolates the follow-on reads: registrations, counts, celebrations', () => {
    for (const section of [
      'upcomingRegistrations',
      'openFollowUps',
      'openWelfare',
      'registrationsBreakdown',
      'celebrations',
    ]) {
      assert.match(src, new RegExp(`'${section}'`), `section ${section} isolated`)
    }
  })

  it('collects named per-section warnings on the response', () => {
    assert.match(src, /warnings/)
    assert.match(src, /section \+ '_unavailable'/)
  })

  it('keeps core identity/scope fail-closed outside any section', () => {
    const scopeAt = src.indexOf('getPortalScope')
    const firstSettle = src.indexOf('settleSection(')
    assert.ok(scopeAt >= 0 && firstSettle > scopeAt, 'scope resolves before any section')
  })

  it('exposes the warnings block on the dashboard payload type', () => {
    const types = read('apps/web/types/portal.ts')
    assert.match(types, /warnings: BranchSectionWarning\[\]/)
  })
})
