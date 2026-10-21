/**
 * AFC-577 contract tests — main dashboard widgets: families, Sunday school,
 * upcoming birthdays/anniversaries.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. The families side reuses the AFC-576 collector (collectPeopleSummary)
 *     instead of duplicating the fold, and gates household figures on the
 *     households read grant.
 *  2. The Sunday School side reads only what the model holds
 *     (sunday_school_classes + sunday_school attendance sessions, no new
 *     collections) and gates on the sunday_school_classes read grant.
 *  3. The birthday/anniversary side is staff-only with the same scoping as
 *     visitor follow-ups (celebrations read AND visitors read), scopes every
 *     read to the caller branches, runs the DOB half only for roles that may
 *     read date_of_birth, and never puts a full DOB, birth year, or age in
 *     the payload.
 *  4. The UI capability-gates each section and deep-links every widget to
 *     the filtered list that produced it.
 *
 * Run: node --test tests/web/dashboard-widgets.contract.mjs
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

/* ---- Inline mirror of occurrenceInWindow in dashboard.get.ts ---- */

function occurrenceMirror(month, day, from, to) {
  const fromYear = Number(from.slice(0, 4))
  for (const year of [fromYear, fromYear + 1]) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const check = new Date(`${candidate}T00:00:00Z`)
    if (
      Number.isNaN(check.getTime()) ||
      check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day
    ) {
      continue
    }
    if (candidate >= from && candidate <= to) return candidate
  }
  return null
}

describe('families: reuse the AFC-576 collector, gate on households read', () => {
  const src = codeOf('apps/web/server/api/dashboard.get.ts')

  it('imports and calls collectPeopleSummary instead of re-folding', () => {
    assert.match(src, /collectPeopleSummary/)
    assert.doesNotMatch(src, /summarizePeopleRows|ageBucketFromDob|age_buckets/)
  })

  it('reports household figures only with the read grant (fail-closed)', () => {
    assert.match(src, /can\(scope, 'households', 'read'\)/)
    assert.match(src, /households_visible/)
  })

  it('exposes the family block and metrics on the dashboard payload', () => {
    const types = read('apps/web/types/portal.ts')
    assert.match(types, /family: \{/)
    assert.match(types, /households: number/)
    assert.match(types, /unlinkedPeople: number/)
    assert.match(types, /avg_members/)
  })
})

describe('sunday school: only what the model supports, no new collections', () => {
  const src = codeOf('apps/web/server/api/dashboard.get.ts')

  it('gates on the sunday_school_classes read grant', () => {
    assert.match(src, /can\(scope, 'sunday_school_classes', 'read'\)/)
  })

  it('reads classes plus sunday_school attendance sessions and nothing else new', () => {
    assert.match(src, /sunday_school_classes/)
    assert.match(src, /session_type.*sunday_school/)
    assert.doesNotMatch(
      src,
      /sunday_school_enrolments|sunday_school_schedule|sunday_school_teachers/,
    )
  })

  it('scopes classes to the caller branches (null branch included, like events)', () => {
    assert.match(src, /branch: \{ _in: scope\.branchIds \}/)
    assert.match(src, /branch: \{ _null: true \}/)
  })

  it('exposes class count, enrolment, and recent sessions on the payload', () => {
    const types = read('apps/web/types/portal.ts')
    assert.match(types, /sundaySchoolClasses: number/)
    assert.match(types, /sundaySchoolEnrolment: number/)
    assert.match(types, /sundaySchoolSessions: DashboardSundaySession\[\]/)
    assert.match(types, /sundaySchoolClasses: SundaySchoolClassRow\[\]/)
  })
})

describe('celebrations: staff-only, scoped, no DOB leak', () => {
  const src = codeOf('apps/web/server/api/dashboard.get.ts')

  it('requires both the celebrations and the visitors read grants', () => {
    assert.match(src, /can\(scope, 'celebrations', 'read'\)/)
    assert.match(src, /can\(scope, 'visitors', 'read'\)/)
  })

  it('scopes celebration reads to the caller zones/branches', () => {
    assert.match(src, /zone: \{ _in: scope\.zoneIds \}/)
    assert.match(src, /branch: \{ _in: scope\.branchIds \}/)
  })

  it('runs the people-DOB half only for roles that may read date_of_birth', () => {
    assert.match(src, /isHidden\(scope, 'people', 'date_of_birth'\)/)
  })

  it('never carries a full DOB, birth year, or age in the celebration item', () => {
    const types = read('apps/web/types/portal.ts')
    const item = types.slice(
      types.indexOf('export interface DashboardCelebrationItem {'),
      types.indexOf('export interface DashboardData {'),
    )
    assert.ok(item.length > 0, 'item block found')
    for (const leaked of ['date_of_birth', 'birth_year', 'age']) {
      assert.doesNotMatch(item, new RegExp(leaked), `item must not carry ${leaked}`)
    }
  })

  it('projects recurring greetings through the shared calendar mapper', () => {
    assert.match(src, /celebrationsToCalendarItems/)
  })
})

describe('occurrence window: next-30-day projection', () => {
  it('finds a month/day inside the window this year', () => {
    assert.strictEqual(occurrenceMirror(3, 14, '2026-03-01', '2026-03-31'), '2026-03-14')
  })

  it('wraps to next year when this year already passed', () => {
    assert.strictEqual(occurrenceMirror(1, 5, '2026-12-20', '2027-01-19'), '2027-01-05')
  })

  it('returns null outside the window', () => {
    assert.strictEqual(occurrenceMirror(6, 1, '2026-03-01', '2026-03-31'), null)
  })

  it('skips Feb 29 in a non-leap year rather than shifting it', () => {
    assert.strictEqual(occurrenceMirror(2, 29, '2026-02-01', '2026-03-02'), null)
  })

  it('keeps Feb 29 in a leap year', () => {
    assert.strictEqual(occurrenceMirror(2, 29, '2028-02-01', '2028-03-02'), '2028-02-29')
  })
})

describe('dashboard UI: gated sections with drill-down links', () => {
  const page = codeOf('apps/web/pages/dashboard.vue')

  it('gates each new section on its collection grant', () => {
    assert.match(page, /canHouseholds/)
    assert.match(page, /canSundaySchool/)
    assert.match(page, /canCelebrations/)
    assert.match(page, /COLLECTIONS\.households/)
    assert.match(page, /COLLECTIONS\.sundaySchoolClasses/)
  })

  it('derives celebration visibility from the follow-ups grant, not celebrations', () => {
    assert.match(page, /canCelebrations.*canVisitors|canVisitors.*canCelebrations/s)
    assert.doesNotMatch(page, /canCelebrations.*COLLECTIONS\.celebrations/)
  })

  it('adds families, sunday-school, and celebrations anchors', () => {
    assert.match(page, /id: 'families'/)
    assert.match(page, /id: 'sunday-school'/)
    assert.match(page, /id: 'celebrations'/)
  })

  it('links every widget to the filtered list that produced it', () => {
    assert.match(page, /to="\/households"/)
    assert.match(page, /to="\/people\?household=unlinked"/)
    assert.match(page, /to="\/attendance"/)
    assert.match(page, /to="\/celebrations"/)
  })
})
