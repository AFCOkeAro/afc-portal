/**
 * AFC-757 contract tests — event unit reports (session headcount capture
 * inside the Reports tab). No new backend: the form posts the existing
 * POST /api/attendance/capture (session header + per-category/sex rows,
 * idempotent via idempotency_key / unique session-category-sex).
 *
 * Pins: capture call shape (event preset, idempotency key, rows),
 * duplicate_capture 409 surfaced (not a twin, not a 400), sessions list
 * scoped to the event, display-total parity (split aggregate with legacy
 * headcount_total fallback), service-types read for categories,
 * scope fail-closed.
 *
 * Run: node --test tests/web/event-unit-reports.contract.mjs
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

const PAGE = 'apps/web/pages/events/[id].vue'
const CAPTURE = 'apps/web/server/api/attendance/capture.post.ts'
const SESSIONS_LIST = 'apps/web/server/api/attendance/index.get.ts'

describe('event unit reports — capture wiring (AFC-757)', () => {
  it('posts the existing capture endpoint with the event preset', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /api\.post\('\/api\/attendance\/capture'/,
      'unit form posts the existing capture route (no new endpoint)',
    )
    assert.match(
      page,
      /event:\s*id/,
      'capture carries the event preset so rows attach to this programme',
    )
    assert.match(
      page,
      /idempotency_key:\s*crypto\.randomUUID\(\)/,
      'every save carries a fresh idempotency key (double-submit safe)',
    )
  })

  it('builds per-category rows in the capture shape', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /sex:\s*'male'|sex:\s*'female'|sex:\s*'unspecified'/,
      'rows use the capture category/sex/count shape',
    )
    assert.match(
      page,
      /count:\s*entry\.male|count:\s*entry\.female/,
      'counts flow into rows',
    )
  })

  it('surfaces duplicate_capture 409 instead of a twin or a 400', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /cause\.status\s*===\s*409/,
      '409 is detected from the failed save',
    )
    assert.match(
      page,
      /Already recorded/,
      'duplicate save names the idempotent outcome, never a twin',
    )
  })

  it('lists only this event’s sessions and sums stored totals', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /\/api\/attendance',\s*\{\s*query:\s*\{\s*event:\s*id/,
      'sessions list is filtered to this event',
    )
    assert.match(page, /headcount_total/, 'legacy stored total still read')
    assert.match(page, /unitTotal/, 'a grand total sums the session totals')
  })

  it('rows render the split aggregate, not the stored total alone (AFC-859)', () => {
    const page = codeOf(PAGE)
    assert.match(page, /unitDisplayTotal/, 'a display-total helper exists')
    assert.match(
      page,
      /unitDisplayTotal\(session\)/,
      'table Total cells render the display total',
    )
    assert.doesNotMatch(
      page,
      /\{\{\s*session\.headcount_total/,
      'no cell renders the stored total alone (fails on headcount_total-only rendering)',
    )
    const server = codeOf(SESSIONS_LIST)
    assert.match(
      server,
      /attendance_counts/,
      'the sessions list batches the split rows server-side',
    )
    assert.match(
      server,
      /split_total/,
      'the sessions list exposes a per-session split total',
    )
  })

  it('unsplit sessions fall back to the stored total (AFC-859)', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /split_total[\s\S]*headcount_total|headcount_total[\s\S]*split_total/,
      'the display total considers both the split sum and the stored total',
    )
    assert.match(
      page,
      /unitTotal[\s\S]*unitDisplayTotal|unitDisplayTotal[\s\S]*unitTotal/,
      'the grand total sums display totals (parity)',
    )
  })

  it('reads categories from service types and respects the split flag', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /\/api\/attendance\/service-types'/,
      'categories come from the service-type definitions',
    )
    assert.match(
      page,
      /supports_sex_split/,
      'single-count types skip the male/female split',
    )
  })
})

describe('event unit reports — server scope (existing guards)', () => {
  it('capture stays fail-closed: scoped branch, zone gate, category check', () => {
    const src = codeOf(CAPTURE)
    assert.match(src, /requireZoneInScope\(scope,\s*form\.zone/, 'zone stays gated')
    assert.match(src, /category_not_offered/, 'unknown categories are refused')
    assert.match(src, /duplicate_capture/, 'replays collide with a named 409')
  })

  it('sessions list stays scoped to the caller', () => {
    const src = codeOf(SESSIONS_LIST)
    assert.match(src, /scopeFilter\(/, 'branch callers see only their rows')
  })
})

describe('AFC-827 pick from the programme session list', () => {
  const CAPTURE = 'apps/web/server/api/attendance/capture.post.ts'

  it('the form offers the programme session list with a manual fallback', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /unitSessionItems/,
      'session picker items derive from the loaded programme sessions',
    )
    assert.match(
      page,
      /New session/,
      'manual entry stays available when no listed session fits',
    )
    assert.match(page, /unitSessionId/, 'the picked session id rides the save')
  })

  it('picking a session auto-fills date and name and locks the manual fields', () => {
    const page = codeOf(PAGE)
    assert.match(
      page,
      /unitPickSession/,
      'picking fills date/type/name from the listed session',
    )
    assert.match(
      page,
      /:disabled="unitSessionId !== ''"/,
      'manual fields lock while a listed session is picked',
    )
  })

  it('the capture route targets the session instead of twinning it', () => {
    const route = codeOf(CAPTURE)
    assert.match(
      route,
      /session_id/,
      'capture accepts an optional existing-session target',
    )
    assert.match(route, /session_not_found/, 'an unknown session id fails closed')
    assert.match(
      route,
      /session_event_mismatch/,
      'a session from another event fails closed',
    )
  })
})
