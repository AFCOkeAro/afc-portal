/**
 * AFC-575 contract tests — calendar views + public/staff calendar option.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *   1. Staff /calendar keeps the staff guard and the scoped feed, and gains
 *      the five views (year/month/week/day/list, month default) with view +
 *      focused date in the query, paging the existing feed per visible
 *      range without raising the server limit.
 *   2. The session-free /api/calendar/public feed returns ONLY
 *      visibility=public AND status=published rows, filtered server-side
 *      and fail-closed, with an allowlisted field set and a stripped
 *      title/date/branch-name payload — non-public and branch-internal
 *      fixtures can never leak through it.
 *   3. The public /calendar/public page renders under the public layout
 *      with no login.
 *
 * Run: node --test tests/web/calendar-views.contract.mjs
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

const STAFF_PAGE = 'apps/web/pages/calendar/index.vue'
const PUBLIC_PAGE = 'apps/web/pages/calendar/public.vue'
const RENDERER = 'apps/web/components/CalendarViews.vue'
const RANGES = 'apps/web/utils/calendar-ranges.ts'
const STAFF_ROUTE = 'apps/web/server/api/calendar/index.get.ts'
const PUBLIC_ROUTE = 'apps/web/server/api/calendar/public.get.ts'

describe('calendar views — staff page', () => {
  it('keeps the staff guard and the scoped feed', () => {
    assert.match(codeOf(STAFF_PAGE), /middleware:\s*'staff'/, 'staff middleware stays')
    assert.match(codeOf(STAFF_PAGE), /\/api\/calendar/, 'reads the scoped feed')
  })

  it('offers all five views with month as the default', () => {
    assert.match(codeOf(RENDERER), /Year/, 'year view offered')
    assert.match(codeOf(RENDERER), /Month/, 'month view offered')
    assert.match(codeOf(RENDERER), /Week/, 'week view offered')
    assert.match(codeOf(RENDERER), /Day/, 'day view offered')
    assert.match(codeOf(RENDERER), /List/, 'list view offered')
    assert.match(codeOf(STAFF_PAGE), /'month'/, 'month default present')
  })

  it('persists view and focused date in the query (deep-linkable)', () => {
    assert.match(codeOf(STAFF_PAGE), /v-model:view/, 'view is state, not local only')
    assert.match(codeOf(STAFF_PAGE), /v-model:focused/, 'focused date is state')
    assert.match(codeOf(STAFF_PAGE), /router\.replace/, 'state syncs to the URL')
    assert.match(codeOf(STAFF_PAGE), /view:\s*view\.value/, 'view lands in the query')
    assert.match(codeOf(STAFF_PAGE), /date:\s*focused\.value/, 'focused date lands in the query')
  })

  it('navigates prev/today/next in every view', () => {
    assert.match(codeOf(RENDERER), /Previous period/, 'prev control')
    assert.match(codeOf(RENDERER), /Next period/, 'next control')
    assert.match(codeOf(RENDERER), /Today/, 'today control')
    assert.match(codeOf(RANGES), /shiftFocused/, 'view-unit stepping helper')
  })

  it('pages the feed per visible range without raising server limits', () => {
    assert.match(codeOf(STAFF_PAGE), /rangeForView/, 'fetch window follows the view')
    assert.match(codeOf(STAFF_PAGE), /date_from/, 'pages date_from')
    assert.match(codeOf(STAFF_PAGE), /date_to/, 'pages date_to')
    assert.match(codeOf(STAFF_ROUTE), /limit:\s*200/, 'server cap stays 200')
    assert.doesNotMatch(codeOf(STAFF_PAGE), /limit/, 'page sends no limit override')
  })

  it('keeps the type filter and detail links working across views', () => {
    assert.match(codeOf(STAFF_PAGE), /item_type/, 'type filter kept')
    assert.match(codeOf(STAFF_PAGE), /href/, 'detail links kept')
  })

  it('carries a staff/public scope toggle previewing the public feed', () => {
    assert.match(codeOf(STAFF_PAGE), /Staff/, 'staff option')
    assert.match(codeOf(STAFF_PAGE), /Public/, 'public option')
    assert.match(codeOf(STAFF_PAGE), /\/api\/calendar\/public/, 'public toggle reads the public feed')
  })
})

describe('calendar views — range helpers', () => {
  it('covers year, month, week, day and list windows', () => {
    const src = codeOf(RANGES)
    for (const view of ['year', 'month', 'week', 'day', 'list']) {
      assert.match(src, new RegExp(`case '${view}'`), `range covers ${view}`)
    }
  })

  it('pads the month window to full weeks and starts weeks on Monday', () => {
    assert.match(codeOf(RANGES), /startOfWeekISO/, 'Monday-start weeks')
    assert.match(codeOf(RANGES), /monthGrid/, 'month grid helper')
  })
})

describe('calendar public feed — no-leak contract', () => {
  it('is session-free (no scope, no session, no cookie)', () => {
    const src = codeOf(PUBLIC_ROUTE)
    assert.doesNotMatch(src, /getPortalScope/, 'never resolves a portal scope')
    assert.doesNotMatch(src, /requireSession/, 'never requires a session')
    assert.doesNotMatch(src, /requireCan/, 'no staff capability check to bypass')
    assert.doesNotMatch(src, /directusServerToken/, 'never holds the server token')
  })

  it('is fail-closed on a missing public token', () => {
    assert.match(codeOf(PUBLIC_ROUTE), /directusPublicToken/, 'uses the public-scoped token')
    assert.match(codeOf(PUBLIC_ROUTE), /503/, 'closed with 503 when the token is absent')
  })

  it('filters visibility=public AND status=published in the query itself', () => {
    const src = codeOf(PUBLIC_ROUTE)
    assert.match(src, /visibility:\s*{\s*_eq:\s*'public'\s*}/, 'public predicate server-side')
    assert.match(src, /status:\s*{\s*_eq:\s*'published'\s*}/, 'published predicate server-side')
    assert.match(src, /filter:\s*eventFilter/, 'event read carries the filter')
    assert.match(src, /filter:\s*celebrationFilter/, 'celebration read carries the filter')
  })

  it('reads an allowlisted field set — contact and internal columns never load', () => {
    const src = codeOf(PUBLIC_ROUTE)
    for (const forbidden of [
      'email',
      'phone',
      'guardian',
      'medical',
      'address',
      'description',
      'contact',
    ]) {
      assert.doesNotMatch(src, new RegExp(forbidden), `never reads ${forbidden}`)
    }
  })

  it('returns title/date/branch-name only, with no staff hrefs', () => {
    const src = codeOf(PUBLIC_ROUTE)
    assert.match(src, /branch_name/, 'branch resolves to a name')
    assert.match(src, /href:\s*null/, 'no deep links into staff pages')
  })

  it('merges through the shared combiner and keeps the 200 cap', () => {
    assert.match(codeOf(PUBLIC_ROUTE), /combineCalendarFeed/, 'shares the feed combiner')
    assert.match(codeOf(PUBLIC_ROUTE), /limit:\s*200/, 'public reads capped at 200')
  })
})

describe('calendar views — public page', () => {
  it('renders under the public layout with no login', () => {
    assert.match(codeOf(PUBLIC_PAGE), /layout:\s*'public'/, 'public layout')
    assert.doesNotMatch(codeOf(PUBLIC_PAGE), /middleware:\s*'staff'/, 'no staff guard')
    assert.doesNotMatch(codeOf(PUBLIC_PAGE), /getPortalScope/, 'no scope required')
  })

  it('reads the public feed with the same view state as staff', () => {
    assert.match(codeOf(PUBLIC_PAGE), /\/api\/calendar\/public/, 'public endpoint')
    assert.match(codeOf(PUBLIC_PAGE), /v-model:view/, 'shared view state')
    assert.match(codeOf(PUBLIC_PAGE), /v-model:focused/, 'shared focused date')
    assert.match(codeOf(PUBLIC_PAGE), /'month'/, 'month default in public too')
    assert.match(codeOf(PUBLIC_PAGE), /CalendarViews/, 'shares the renderer')
  })
})
