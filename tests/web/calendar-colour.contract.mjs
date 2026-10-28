/**
 * AFC-853 contract — colourful calendar (Kargul reference language).
 *
 * Pastel type pills with dark-mode variants, coloured month/week/day/list
 * rendering, clickable legend chips with counts, keyboard shortcuts.
 * Display only: feeds, scope and links are untouched. No drag-and-drop,
 * no now-line (feed rows carry no end times) — explicit non-goals.
 *
 * Run: node --test tests/web/calendar-colour.contract.mjs
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

const SHARED = 'packages/shared/src/office-feed.ts'
const VIEWS = 'apps/web/components/CalendarViews.vue'
const STAFF = 'apps/web/pages/calendar/index.vue'
const PUBLIC = 'apps/web/pages/calendar/public.vue'

describe('AFC-853 calendar colour language', () => {
  it('every feed type has a pastel pill and dark variant', () => {
    const src = codeOf(SHARED)
    for (const type of ['service', 'event', 'programme', 'celebration']) {
      assert.match(src, new RegExp(type + ': \\{'), `${type} has a colour entry`)
    }
    assert.match(src, /calendarPillClass/)
    assert.match(src, /dark:/, 'dark-mode variants present')
  })

  it('month, week, day and list render pills, not plain text', () => {
    const src = codeOf(VIEWS)
    assert.ok(
      src.match(/calendarPillClass\(item\.item_type\)/g).length >= 4,
      'pills in all views',
    )
    assert.doesNotMatch(src, /color="neutral" variant="subtle"/, 'no neutral badges left')
  })

  it('both pages show clickable legend chips with counts', () => {
    for (const rel of [STAFF, PUBLIC]) {
      const src = codeOf(rel)
      assert.match(src, /CALENDAR_TYPE_META/, `${rel} renders the legend`)
      assert.match(src, /toggleType/, `${rel} chips filter`)
      assert.match(src, /legendCounts/, `${rel} chips carry counts`)
    }
  })

  it('the staff page keeps deep links and adds shortcuts', () => {
    const src = codeOf(STAFF)
    assert.match(src, /:to="String\(item\.href\)"/, 'staff rows still link out')
    assert.match(src, /onCalendarKeys/, 'keyboard shortcuts wired')
    assert.match(src, /T today/, 'shortcut hint rendered')
  })

  it('the public page stays link-free', () => {
    const src = codeOf(PUBLIC)
    assert.doesNotMatch(
      src,
      /:to="String\(item\.href\)"/,
      'no staff hrefs leak to public',
    )
  })
})
