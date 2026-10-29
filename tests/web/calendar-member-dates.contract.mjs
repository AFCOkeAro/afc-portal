/**
 * AFC-879 contract tests — calendar member dates + task/meeting feed + category checklist.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *   1. The shared feed knows the new categories (birthday, anniversary,
 *      task, meeting) and the query schema accepts them.
 *   2. The staff feed reads people DOB month/day (DOB-gated: roles without
 *      the restricted grant contribute zero birthday rows), household
 *      wedding dates, open task due dates, and office-minutes meetings —
 *      and never exposes birth year, age, or DOB.
 *   3. The staff page carries a per-staff persisted category checklist and
 *      the renderer/legend follows the visible set.
 *   4. Guards kept: the public feed stays events-only (no member dates,
 *      no tasks), staff route unchanged.
 *
 * Run: node --test tests/web/calendar-member-dates.contract.mjs
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

const FEED = 'packages/shared/src/office-feed.ts'
const SCHEMA = 'packages/shared/src/schemas/office.ts'
const RANGES = 'apps/web/utils/calendar-ranges.ts'
const RENDERER = 'apps/web/components/CalendarViews.vue'
const STAFF_PAGE = 'apps/web/pages/calendar/index.vue'
const STAFF_ROUTE = 'apps/web/server/api/calendar/index.get.ts'
const PUBLIC_ROUTE = 'apps/web/server/api/calendar/public.get.ts'

const NEW_TYPES = ['birthday', 'anniversary', 'task', 'meeting']

describe('member dates — shared feed and schema know the new categories', () => {
  it('CALENDAR_ITEM_TYPES covers the checklist set', () => {
    const src = codeOf(FEED)
    for (const type of [...NEW_TYPES, 'service', 'event', 'programme', 'celebration']) {
      assert.ok(src.includes(`'${type}'`), `feed knows ${type}`)
    }
  })

  it('the combiner merges every category and the query schema accepts them', () => {
    const feed = codeOf(FEED)
    for (const type of NEW_TYPES) {
      assert.match(feed, new RegExp(`parts\\.${type}`), `combiner merges ${type}`)
    }
    const schema = codeOf(SCHEMA)
    for (const type of NEW_TYPES) {
      assert.ok(schema.includes(`'${type}'`), `query schema accepts ${type}`)
    }
  })

  it('countByType covers the new categories for legend counts', () => {
    const src = codeOf(RANGES)
    for (const type of NEW_TYPES) {
      assert.ok(src.includes(`${type}: 0`), `counter seeds ${type}`)
    }
  })
})

describe('member dates — staff feed reads month/day only, never year/age/DOB', () => {
  it('birthdays are DOB-gated: no grant means zero birthday rows', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.match(
      src,
      /isHidden\(scope, 'people', 'date_of_birth'\)/,
      'DOB grant gates the people read',
    )
    assert.match(src, /mayReadDob/, 'gate result names the birthday domain')
    assert.match(src, /date_of_birth/, 'DOB month/day is the source column')
  })

  it('projects occurrences from month/day without echoing the source year', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.match(src, /occurrencesInWindow/, 'recurring month/day projection helper')
    assert.match(src, /wedding_date/, 'anniversaries read the household wedding date')
    assert.doesNotMatch(
      src,
      /match\[1\]|getAge|\bage\b/,
      'the source year/age never reaches the response',
    )
  })

  it('task and meeting domains read due/meeting dates, open tasks only', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.match(src, /due_date/, 'tasks read the due date')
    assert.match(src, /meeting_date/, 'meetings read office_minutes')
    assert.match(src, /office_minutes/, 'meetings domain present')
    assert.match(src, /done.*cancelled|cancelled.*done/, 'terminal tasks excluded')
    assert.doesNotMatch(src, /description/, 'descriptions never enter the feed')
  })

  it('marriage cases stay out: announce already writes those weddings as events', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.doesNotMatch(src, /marriage_cases/, 'no double-counted wedding rows')
  })
})

describe('member dates — checklist persisted per staff, legend follows visible set', () => {
  it('the page carries a category checklist persisted per staff member', () => {
    const src = codeOf(STAFF_PAGE)
    assert.match(src, /checkedTypes/, 'checklist state')
    assert.match(src, /checkbox/, 'checkbox inputs')
    assert.match(src, /localStorage/, 'preference persisted client-side')
    assert.match(src, /afc:calendar-categories:/, 'storage key is namespaced')
    assert.match(src, /user\.value\?\.id|userId/, 'keyed per staff member')
  })

  it('legend and grid read the visible set, not the raw feed', () => {
    const src = codeOf(STAFF_PAGE)
    assert.match(src, /visible/, 'visible-set filter exists')
    assert.match(src, /:items="rows"/, 'renderer receives the filtered rows')
  })

  it('the renderer colours and legends every category', () => {
    const src = codeOf(RENDERER)
    for (const type of NEW_TYPES) {
      assert.ok(src.includes(`${type}:`), `renderer styles ${type}`)
    }
    assert.match(src, /TYPE_ORDER/, 'stable type order covers the legend')
  })
})

describe('member dates — public feed stays events-only', () => {
  it('no birthdays, anniversaries, tasks or meetings leave the public route', () => {
    const src = codeOf(PUBLIC_ROUTE)
    for (const type of NEW_TYPES) {
      assert.ok(!src.includes(`'${type}'`), `public feed has no ${type}`)
    }
    assert.doesNotMatch(
      src,
      /date_of_birth|wedding_date|due_date/,
      'no member/task date columns',
    )
  })
})
