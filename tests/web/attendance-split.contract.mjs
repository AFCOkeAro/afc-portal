/**
 * AFC-496 contract tests — attendance split convergence (AFC-468 US-A1..A4).
 *
 * Pure node:test, no dependencies. Asserts the route/page layer converged onto
 * the split contract rather than forked beside the legacy headcount paths:
 *  1. The report validates its query with `attendanceReportQuerySchema`
 *     (group_by branch|zone, session_type, period, dates, compare, page/limit)
 *     plus scope-checked branch/zone refinements.
 *  2. Permission scope is fail-closed in the route layer: a foreign branch is
 *     a 403 (`branch_out_of_scope`), a foreign zone is a 403
 *     (`zone_out_of_scope`), and both the header and the zone predicates go
 *     through `scopeFilter`/`zoneScopeFilter`.
 *  3. The CSV serialises the SAME filtered aggregate the query returns (it
 *     reads `collectSplitAggregate`, the report's own builder input), with
 *     the contract columns and a bounded chunked read plus a documented
 *     refusal (`range_too_large`) instead of an unbounded buffer.
 *  4. Capture enforces the per-service-type category sets (reads the active
 *     `service_type_definitions` row, rejects un-offered categories), refuses
 *     a replayed idempotency key (409, no twin), and converges replays
 *     (read-then-PATCH, unchanged rows untouched).
 *  5. The capture form renders only the configured categories with male /
 *     female inputs, an auto-summed total, and a stable idempotency key
 *     across a retry.
 *  6. None of the touched paths names the breach clock or a retention period
 *     (the gates scan these paths).
 *
 * Run: node --test tests/web/attendance-split.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const builder = read('apps/web/server/utils/attendance-report.ts')
const reportRoute = read('apps/web/server/api/attendance/report.get.ts')
const csvRoute = read('apps/web/server/api/attendance/report.csv.get.ts')
const captureRoute = read('apps/web/server/api/attendance/capture.post.ts')
const definitionsRoute = read('apps/web/server/api/attendance/service-types.get.ts')
const form = read('apps/web/components/AttendanceFormModal.vue')
const page = read('apps/web/pages/attendance/report.vue')

describe('report query contract (US-A3)', () => {
  it('validates the query with attendanceReportQuerySchema', () => {
    assert.match(builder, /attendanceReportQuerySchema/)
    assert.match(builder, /\.extend\(\{ branch:.*zone:/)
  })

  it('groups by branch|zone over category x sex x date bucket', () => {
    assert.match(builder, /collectSplitAggregate/)
    assert.match(builder, /groupBy: query\.group_by/)
    assert.match(builder, /bucketFor\(session\.session_date, options\.period\)/)
    assert.match(builder, /count\.sex === 'male'/)
    assert.match(builder, /count\.sex === 'female'/)
  })

  it('supports the period presets and requires an explicit custom range', () => {
    for (const preset of ['weekly', 'monthly', 'quarterly']) {
      assert.match(builder, new RegExp(`period === '${preset}'`))
    }
    assert.match(builder, /A custom period needs both date_from and date_to/)
  })

  it('paginates the grouped rows with a total', () => {
    assert.match(builder, /aggregate\.rows\.slice\(start, start \+ query\.limit\)/)
    assert.match(builder, /meta: \{ total: aggregate\.rows\.length/)
  })

  it('toggles a prior-year compare with a has_data flag', () => {
    assert.match(builder, /compare_prior_year/)
    assert.match(builder, /shiftYear\(from, -1\)/)
    assert.match(builder, /has_data: prior\.sessions > 0/)
  })

  it('the report route is a thin wrapper over the shared builder', () => {
    assert.match(reportRoute, /buildAttendanceReport/)
    assert.doesNotMatch(reportRoute, /headcount_/)
  })
})

describe('report permission scope (US-A3 AC4)', () => {
  it('requires read grants on both split tables', () => {
    assert.match(builder, /requireCan\(activeScope, 'attendance_sessions', 'read'\)/)
    assert.match(builder, /requireCan\(activeScope, 'attendance_counts', 'read'\)/)
  })

  it('rejects a branch outside the caller scope with a 403', () => {
    assert.match(builder, /branch_out_of_scope/)
    assert.match(builder, /scopeFilter\(scope\)/)
  })

  it('rejects a zone outside the caller scope with a 403', () => {
    assert.match(builder, /requireZoneInScope\(activeScope, requestedZone/)
    assert.match(builder, /zoneScopeFilter\(scope\)/)
  })

  it('constrains the session read by both predicates at once', () => {
    assert.match(builder, /scopeFilter\(scope\),\s*\n?\s*zoneScopeFilter\(scope\)/)
  })
})

describe('CSV export (US-A3 AC3-AC4)', () => {
  it('serialises the same filtered aggregate as the query', () => {
    assert.match(csvRoute, /collectSplitAggregate/)
    assert.match(csvRoute, /buildAttendanceReport\(event, scope\)/)
  })

  it('emits the contract columns in order', () => {
    assert.match(
      csvRoute,
      /\['branch', 'zone', 'service', 'date', 'category', 'male', 'female', 'total'\]/,
    )
  })

  it('reads in bounded chunks and refuses an unbounded range with guidance', () => {
    assert.match(builder, /SESSION_CHUNK = 200/)
    assert.match(csvRoute, /range_too_large/)
    assert.match(csvRoute, /Narrow the dates or pick one service type/)
    assert.doesNotMatch(csvRoute, /limit: -1/)
  })

  it('stays permission-scoped: a branch export holds only its own branch', () => {
    assert.match(csvRoute, /getPortalScope/)
    assert.match(csvRoute, /branch: report\.filters\.branch/)
    assert.match(csvRoute, /zone: report\.filters\.zone/)
  })
})

describe('split capture (US-A1)', () => {
  it('requires create grants on the session header and the counts', () => {
    assert.match(captureRoute, /requireCan\(scope, 'attendance_sessions', 'create'\)/)
    assert.match(captureRoute, /requireCan\(scope, 'attendance_counts', 'create'\)/)
  })

  it('files into the caller branch and zone scope, fail-closed', () => {
    assert.match(captureRoute, /resolveBranch\(scope, form\.branch\)/)
    assert.match(captureRoute, /requireZoneInScope\(scope, form\.zone/)
  })

  it('enforces the per-service-type category set from the active definition', () => {
    assert.match(captureRoute, /service_type_definitions/)
    assert.match(captureRoute, /status: \{ _eq: 'active' \}/)
    assert.match(captureRoute, /category_not_offered/)
    assert.match(captureRoute, /is not offered for/)
  })

  it('refuses a replayed idempotency key instead of filing a twin', () => {
    assert.match(captureRoute, /idempotency_key: form\.idempotency_key/)
    assert.match(captureRoute, /duplicate_capture/)
    assert.match(captureRoute, /statusCode: 409/)
  })

  it('converges a replayed batch: patches what changed, skips what matches', () => {
    assert.match(captureRoute, /Number\(current\.count\) === row\.count\) continue/)
    assert.match(captureRoute, /method: 'PATCH'/)
  })

  it('records who filed the capture and when', () => {
    assert.match(captureRoute, /recorded_by: scope\.session\.user\.id/)
    assert.match(captureRoute, /recorded_at: form\.recorded_at \?\? new Date/)
  })

  it('the definitions route serves the board config the form renders', () => {
    assert.match(
      definitionsRoute,
      /requireCan\(scope, 'service_type_definitions', 'read'\)/,
    )
    assert.match(definitionsRoute, /status: \{ _eq: 'active' \}/)
  })

  it('the form renders only the configured categories with sex-split inputs', () => {
    assert.match(form, /\/api\/attendance\/service-types/)
    assert.match(form, /activeDefinition(\.value)?\?\.categories/)
    assert.match(form, /counts\[category\]\.male/)
    assert.match(form, /counts\[category\]\.female/)
  })

  it('the form auto-sums the total and keeps one key across a retry', () => {
    assert.match(form, /batchTotal\(/)
    assert.match(form, /idempotencyKey\.value = newKey\(\)/)
    assert.match(form, /keeps its idempotency key/)
  })
})

describe('report page convergence (US-A2..A4)', () => {
  it('filters by group, period, service type, branch and zone', () => {
    assert.match(page, /group_by: groupBy\.value/)
    assert.match(page, /period: period\.value/)
    assert.match(page, /session_type: sessionType\.value/)
  })

  it('shows the split breakdown with a prior-year hint', () => {
    assert.match(page, /row\.male/)
    assert.match(page, /row\.female/)
    assert.match(page, /row\.category/)
    assert.match(page, /Prior year:/)
  })

  it('exports the same filtered aggregate as CSV', () => {
    assert.match(page, /\/api\/attendance\/report\.csv\?/)
  })
})

describe('gate hygiene on the touched paths', () => {
  const touched = [
    builder,
    reportRoute,
    csvRoute,
    captureRoute,
    definitionsRoute,
    form,
    page,
  ]

  it('names no breach clock and no retention period', () => {
    for (const source of touched) {
      assert.doesNotMatch(source, /awareness_at/)
      assert.doesNotMatch(source, /INTERVAL\s*'[^']*(year|month|day)/i)
    }
  })

  it('carries no personal data beyond headcounts', () => {
    for (const source of [builder, csvRoute]) {
      assert.doesNotMatch(source, /first_name/)
      assert.doesNotMatch(source, /phone/)
      assert.doesNotMatch(source, /email/)
    }
  })
})
