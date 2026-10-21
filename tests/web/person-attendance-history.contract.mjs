/**
 * AFC-597 contract tests — per-person attendance history chart (Sunday
 * School tracking).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. GET /api/people/:id/attendance is a scoped pure read: people read +
 *     attendance_sessions read grants, the person resolves via findScopedItem
 *     (out-of-scope is a 404, fail-closed), and sessions are constrained by
 *     scopeFilter + zoneScopeFilter, so foreign sessions never enter the held
 *     denominator or the present numerator.
 *  2. Query contract: weeks defaults to 12 and is clamped to 1-52 with a
 *     validation_error; session_type is validated against SERVICE_TYPE_KEYS.
 *  3. Bucket logic: Monday-start weeks, sessions_held counts scoped sessions
 *     in the week, present is 1 when the person attended a scoped session
 *     that week; empty history yields zeroed buckets and empty sessions.
 *  4. Profile widget: plain SVG bars (no chart dependency), Sunday School
 *     the default filter, single-session weeks link to the session page, and
 *     the widget sits inside the capability-gated attendance section.
 *  5. Gate hygiene on the touched paths.
 *
 * Run: node --test tests/web/person-attendance-history.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const DAY_MS = 86_400_000

function weekStartFor(day) {
  const date = new Date(`${day}T00:00:00Z`)
  const offset = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10)
}

/** Mirror of the route bucket fold: held counts scoped sessions, present is binary. */
function foldBuckets(weekStarts, scopedSessions, attendedSessionIds) {
  const buckets = weekStarts.map((week_start) => ({
    week_start,
    sessions_held: 0,
    present: 0,
  }))
  const index = new Map(weekStarts.map((week, i) => [week, i]))
  for (const session of scopedSessions) {
    buckets[index.get(weekStartFor(session.session_date))].sessions_held += 1
  }
  const seen = new Set()
  for (const session of scopedSessions) {
    if (!attendedSessionIds.has(session.id)) continue
    const week = weekStartFor(session.session_date)
    if (seen.has(week)) continue
    seen.add(week)
    buckets[index.get(week)].present = 1
  }
  return buckets
}

describe('route: scoped pure read, fail-closed', () => {
  const route = read('apps/web/server/api/people/[id]/attendance.get.ts')

  it('ships the route file', () => {
    assert.ok(
      existsSync(path.join(root, 'apps/web/server/api/people/[id]/attendance.get.ts')),
    )
  })

  it('requires the people and attendance_sessions read grants', () => {
    assert.match(route, /requireCan\(scope, 'people', 'read'\)/)
    assert.match(route, /requireCan\(scope, 'attendance_sessions', 'read'\)/)
  })

  it('resolves the person through findScopedItem (out-of-scope is a 404)', () => {
    assert.match(route, /findScopedItem\(event, scope, 'people', id/)
  })

  it('constrains sessions by the caller branch and zone scope', () => {
    assert.match(route, /scopeFilter\(scope\)/)
    assert.match(route, /zoneScopeFilter\(scope\)/)
  })

  it('writes nothing: no create/update/delete, no new collections', () => {
    const src = codeOf('apps/web/server/api/people/[id]/attendance.get.ts')
    assert.doesNotMatch(src, /createItem/)
    assert.doesNotMatch(src, /updateItem/)
    assert.doesNotMatch(src, /deleteItem/)
    assert.doesNotMatch(src, /method: '(POST|PATCH|PUT|DELETE)'/)
  })

  it('maps an unreadable store to the named attendance error, keeping deliberate 4xx', () => {
    assert.match(route, /throwStoreUnavailable\(error, 'attendance_store', '0023'\)/)
    assert.match(route, /statusCode\?: number \}\)\?\.statusCode\) throw error/)
  })
})

describe('query contract: weeks window and session_type filter', () => {
  const route = read('apps/web/server/api/people/[id]/attendance.get.ts')

  it('defaults to 12 weeks and clamps to 1-52 with a validation error', () => {
    assert.match(route, /DEFAULT_WEEKS = 12/)
    assert.match(route, /MAX_WEEKS = 52/)
    assert.match(route, /validation_error/)
  })

  it('validates session_type against SERVICE_TYPE_KEYS', () => {
    assert.match(route, /SERVICE_TYPE_KEYS/)
    assert.match(route, /Unknown session type/)
  })

  it('an empty type param means all types (filter omitted, not forced)', () => {
    assert.match(route, /sessionType \? \{ session_type: \{ _eq: sessionType \} \} : undefined/)
  })
})

describe('bucket logic: Monday weeks, held vs present', () => {
  it('weeks start on Monday', () => {
    assert.equal(weekStartFor('2026-10-21'), '2026-10-19')
    assert.equal(weekStartFor('2026-10-19'), '2026-10-19')
    assert.equal(weekStartFor('2026-10-18'), '2026-10-12')
  })

  it('counts held sessions per week and marks presence binary', () => {
    const weeks = ['2026-10-12', '2026-10-19']
    const sessions = [
      { id: 'a', session_date: '2026-10-13' },
      { id: 'b', session_date: '2026-10-14' },
      { id: 'c', session_date: '2026-10-20' },
    ]
    const buckets = foldBuckets(weeks, sessions, new Set(['a', 'b']))
    assert.deepEqual(buckets[0], { week_start: '2026-10-12', sessions_held: 2, present: 1 })
    assert.deepEqual(buckets[1], { week_start: '2026-10-19', sessions_held: 1, present: 0 })
  })

  it('empty history yields zeroed buckets and no sessions', () => {
    const buckets = foldBuckets(['2026-10-12', '2026-10-19'], [], new Set())
    for (const bucket of buckets) {
      assert.equal(bucket.sessions_held, 0)
      assert.equal(bucket.present, 0)
    }
  })

  it('check-ins on out-of-scope sessions never mark presence', () => {
    // The route only folds records whose session id is in the scoped set;
    // a record pointing outside it is skipped before this fold runs.
    const weeks = ['2026-10-19']
    const scoped = [{ id: 'in-scope', session_date: '2026-10-20' }]
    const buckets = foldBuckets(weeks, scoped, new Set(['foreign-session']))
    assert.equal(buckets[0].present, 0)
  })

  it('the route intersects records with the scoped session set', () => {
    const route = read('apps/web/server/api/people/[id]/attendance.get.ts')
    assert.match(route, /scopedSessions\.get\(key\)/)
    assert.match(route, /if \(!session\) continue/)
  })

  it('session links point at the attendance detail page', () => {
    const route = read('apps/web/server/api/people/[id]/attendance.get.ts')
    assert.match(route, /href: `\/attendance\/\$\{session\.id\}`/)
  })
})

describe('widget: SVG chart with the Sunday School default', () => {
  const widget = read('apps/web/components/PersonAttendanceChart.vue')

  it('ships the widget file', () => {
    assert.ok(
      existsSync(path.join(root, 'apps/web/components/PersonAttendanceChart.vue')),
    )
  })

  it('renders plain SVG bars with no chart dependency', () => {
    assert.match(widget, /<svg/)
    assert.match(widget, /<rect/)
    assert.match(widget, /data-testid="person-attendance-chart"/)
    assert.doesNotMatch(widget.toLowerCase(), /chart\.js|echarts|apexcharts|d3/)
  })

  it('defaults to the Sunday School filter with All plus the service types', () => {
    assert.match(widget, /ref<string>\('sunday_school'\)/)
    assert.match(widget, /All types/)
    assert.match(widget, /sunday_school/)
  })

  it('links a week bar to its session only when exactly one was attended', () => {
    assert.match(widget, /rows\.length !== 1\) return null/)
    assert.match(widget, /\/api\/people\/\$\{props\.personId\}\/attendance/)
  })

  it('summarises attended vs held for screen readers', () => {
    assert.match(widget, /role="img"/)
    assert.match(widget, /aria-label/)
    assert.match(widget, /sessions_attended/)
    assert.match(widget, /sessions_held/)
  })

  it('lives in the capability-gated attendance section of the profile', () => {
    const page = read('apps/web/pages/people/[id].vue')
    assert.match(page, /<PersonAttendanceChart :person-id="id"/)
    assert.match(page, /v-if="canAttendance"/)
  })
})

describe('types: history payload without PII', () => {
  const types = read('apps/web/types/portal.ts')

  it('pins the bucket/session/history interfaces', () => {
    assert.match(types, /PersonAttendanceBucket/)
    assert.match(types, /PersonAttendanceHistory/)
    assert.match(types, /sessions_attended/)
    assert.match(types, /weeks_present/)
  })

  it('carries session names and dates only — no DOB, phone, or address', () => {
    const block = types.slice(
      types.indexOf('One week of per-person attendance history'),
      types.indexOf('export interface HouseholdRow'),
    )
    assert.ok(block.length > 0, 'history payload block found')
    for (const pii of ['date_of_birth', 'phone', 'email', 'address']) {
      assert.doesNotMatch(block, new RegExp(pii), `history payload must not carry ${pii}`)
    }
  })
})

describe('gate hygiene on the touched paths', () => {
  const touched = [
    read('apps/web/server/api/people/[id]/attendance.get.ts'),
    read('apps/web/components/PersonAttendanceChart.vue'),
    read('apps/web/pages/people/[id].vue'),
  ]

  it('names no breach clock and no retention period', () => {
    for (const source of touched) {
      assert.doesNotMatch(source, /awareness_at/)
      assert.doesNotMatch(source, /INTERVAL\s*'[^']*(year|month|day)/i)
    }
  })
})
