/**
 * AFC-865 contract tests — calendar colour + full dates + Year 12-month view.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *   1. Colour by item_type/calendar with a legend (one colour map owns
 *      every coloured surface so the legend cannot drift from the grid).
 *   2. Every date cell renders its number even when empty — no blank
 *      hiding; the global "no entries" gate is gone from month/week/day/
 *      year (list alone keeps the empty state).
 *   3. Year view renders 12 mini-months with counts and colour dots,
 *      deep-linkable via ?view=year.
 *   4. Guards kept: staff/public scope, month default, scoped feed (no
 *      leak), server cap 200 unchanged.
 *
 * Run: node --test tests/web/calendar-colour-year.contract.mjs
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

const RENDERER = 'apps/web/components/CalendarViews.vue'
const RANGES = 'apps/web/utils/calendar-ranges.ts'
const STAFF_PAGE = 'apps/web/pages/calendar/index.vue'
const STAFF_ROUTE = 'apps/web/server/api/calendar/index.get.ts'
const PUBLIC_ROUTE = 'apps/web/server/api/calendar/public.get.ts'

describe('calendar colour — legend and per-type surfaces', () => {
  it('owns one colour map keyed by item_type with a visible legend', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /TYPE_META/, 'single colour map')
    assert.match(src, /legend/i, 'legend rendered')
    for (const type of ['service', 'event', 'programme', 'celebration']) {
      assert.ok(src.includes(`'${type}'`) || src.includes(`"${type}"`), `covers ${type}`)
    }
  })

  it('colours month blocks, week pills and day/list badges by type', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /\.bar/, 'month coloured blocks')
    assert.match(src, /\.pill/, 'week pastel pills / badges')
    assert.match(src, /\.dot/, 'dots share the map')
  })

  it('exposes a pure per-type counter for legend and year counts', () => {
    assert.match(codeOf(RANGES), /countByType/, 'countByType helper in calendar-ranges')
    assert.match(codeOf(RENDERER), /countByType/, 'renderer uses the shared counter')
  })
})

describe('calendar full dates — no blank hiding', () => {
  it('renders month/week/day/year grids even when the window is empty', () => {
    const src = codeOf(RENDERER)
    assert.doesNotMatch(
      src,
      /v-else-if="items\.length === 0"/,
      'no global empty gate hiding the grids',
    )
  })

  it('keeps the empty state for the list view only', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /listGroups\.length === 0/, 'list keeps its empty state')
    assert.match(src, /No calendar entries in this window/, 'empty copy kept')
  })

  it('keeps day numbers and a no-entries note on empty week days', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /No entries/, 'empty week days labelled, not hidden')
  })
})

describe('calendar year view — twelve mini-months', () => {
  it('renders twelve mini-month grids from yearMonths + monthGrid', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /yearMonths\(focused\)/, 'iterates all twelve months')
    assert.match(src, /monthGrid\(monthStart\)/, 'each month renders its grid')
    assert.match(src, /countInMonth\(monthStart\)/, 'each mini-month shows its count')
    assert.match(src, /typesOn\(iso\)/, 'each day carries colour dots')
  })

  it('deep-links year view through the query with month default kept', () => {
    assert.match(codeOf(RANGES), /'year'/, 'year is a known view')
    assert.match(codeOf(STAFF_PAGE), /v-model:view/, 'view state syncs to URL')
    assert.match(codeOf(STAFF_PAGE), /'month'/, 'month stays the default')
  })

  it('drills from year into month and day views', () => {
    const src = codeOf(RENDERER)
    assert.match(src, /openMonth\(monthStart\)/, 'month title drills to month view')
    assert.match(src, /openDay\(iso\)/, 'mini-month days drill to day view')
  })
})

describe('calendar colour/year — guards unchanged (failure-shape sentinels)', () => {
  it('keeps staff/public scope and the scoped feed', () => {
    assert.match(codeOf(STAFF_PAGE), /middleware:\s*'staff'/, 'staff guard stays')
    assert.match(codeOf(STAFF_PAGE), /\/api\/calendar\/public/, 'public preview stays')
  })

  it('keeps the server cap and the public no-leak predicates', () => {
    assert.match(codeOf(STAFF_ROUTE), /limit:\s*200/, 'staff cap stays 200')
    assert.match(
      codeOf(PUBLIC_ROUTE),
      /visibility:\s*{\s*_eq:\s*'public'\s*}/,
      'public predicate stays',
    )
    assert.match(
      codeOf(PUBLIC_ROUTE),
      /status:\s*{\s*_eq:\s*'published'\s*}/,
      'published predicate stays',
    )
    assert.doesNotMatch(
      codeOf(PUBLIC_ROUTE),
      /celebration/,
      'public feed stays events-only',
    )
  })
})

describe('AFC-879 member dates + tasks on the staff calendar', () => {
  it('the shared feed knows the four new categories', () => {
    const src = read('packages/shared/src/office-feed.ts')
    for (const type of ['birthday', 'anniversary', 'task', 'marriage']) {
      assert.ok(src.includes(`'${type}'`), `feed type ${type}`)
    }
    assert.match(src, /birthday: {/, 'birthday meta')
    assert.match(src, /anniversary: {/, 'anniversary meta')
    assert.match(src, /task: {/, 'task meta')
    assert.match(src, /marriage: {/, 'marriage meta')
  })

  it('the staff route projects recurring greetings and adds tasks + marriages', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.match(src, /is_recurring/, 'reads the recurrence mark')
    assert.match(src, /recurringDates/, 'projects month/day into the window')
    assert.match(src, /tasks/, 'reads open tasks by due date')
    assert.match(src, /marriage_cases/, 'reads wedding dates')
    assert.match(src, /_nin: \['done', 'cancelled'\]/, 'terminal tasks excluded')
  })

  it('recurring greetings carry no birth year, age, or DOB', () => {
    const src = codeOf(STAFF_ROUTE)
    assert.doesNotMatch(src, /date_of_birth/, 'no DOB column read')
    assert.doesNotMatch(
      src,
      /raw\.slice\(0, 4\)/,
      'the register year is never stamped (projection uses the window year)',
    )
    assert.match(src, /slice\(5, 7\)/, 'only month/day feed the projection')
  })

  it('the checklist hides categories client-side with persistence', () => {
    const src = codeOf(STAFF_PAGE)
    assert.match(src, /hiddenTypes/, 'hidden-set state')
    assert.match(src, /afc-calendar-hidden-types/, 'persisted per staff member')
    assert.match(src, /shownRows/, 'grid follows the checklist')
    assert.match(src, /toggleHidden/, 'checkboxes toggle')
  })

  it('the renderer colours the new categories from the same map', () => {
    const src = codeOf(RENDERER)
    for (const type of ['birthday', 'anniversary', 'task', 'marriage']) {
      assert.ok(src.includes(`'${type}'`), `renderer covers ${type}`)
    }
  })
})
