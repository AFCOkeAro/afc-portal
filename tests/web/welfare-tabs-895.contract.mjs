/**
 * AFC-895 contract — welfare restructure: the visitor funnel is a tab inside
 * Visitors, and the welfare report is a tab inside Welfare.
 *
 * No standalone `/visitors/funnel` or `/welfare/reports` surfaces: the nav
 * carries only Visitors and Welfare, and the old routes redirect (301) to
 * the tabbed pages. No new registers; scoping and gates are unchanged.
 *
 * Run: node --test tests/web/welfare-tabs-895.contract.mjs
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

const NAV = 'apps/web/utils/navigation.ts'
const VISITORS = 'apps/web/pages/visitors/index.vue'
const WELFARE = 'apps/web/pages/welfare/index.vue'
const FUNNEL_REDIRECT = 'apps/web/pages/visitors/funnel.vue'
const REPORTS_REDIRECT = 'apps/web/pages/welfare/reports.vue'
const FUNNEL_PANEL = 'apps/web/components/VisitorFunnelPanel.vue'
const REPORTS_PANEL = 'apps/web/components/WelfareReportsPanel.vue'

describe('AFC-895 welfare tabs', () => {
  it('the nav keeps Visitors and Welfare with unchanged gates', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'Visitors',\n\s+to: '\/visitors'/)
    assert.match(src, /label: 'Welfare',\n\s+to: '\/welfare'/)
    assert.match(src, /requires: \['visitors', 'read'\]/)
    assert.match(src, /requires: \['welfare_cases', 'read'\]/)
  })

  it('the nav has no standalone funnel or welfare-report entries', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /Visitor funnel/)
    assert.doesNotMatch(src, /Welfare reports/)
    assert.doesNotMatch(src, /to: '\/visitors\/funnel'/)
    assert.doesNotMatch(src, /to: '\/welfare\/reports'/)
  })

  it('Visitors carries list + funnel tabs deep-linked by ?tab=', () => {
    const src = codeOf(VISITORS)
    assert.match(src, /id: 'list'/)
    assert.match(src, /id: 'funnel'/)
    assert.match(src, /route\.query\.tab/)
    assert.match(
      src,
      /router\.replace\(\{ query: \{ \.\.\.route\.query, tab: next \} \}\)/,
    )
    assert.match(src, /<VisitorFunnelPanel \/>/)
  })

  it('Visitors no longer links out to a standalone funnel route', () => {
    const src = codeOf(VISITORS)
    assert.doesNotMatch(src, /to="\/visitors\/funnel"/)
    assert.doesNotMatch(src, /to: '\/visitors\/funnel'/)
  })

  it('Welfare carries cases + reports tabs deep-linked by ?tab=', () => {
    const src = codeOf(WELFARE)
    assert.match(src, /id: 'cases'/)
    assert.match(src, /id: 'reports'/)
    assert.match(src, /route\.query\.tab/)
    assert.match(
      src,
      /router\.replace\(\{ query: \{ \.\.\.route\.query, tab: next \} \}\)/,
    )
    assert.match(src, /<WelfareReportsPanel \/>/)
  })

  it('Welfare no longer links out to a standalone reports route', () => {
    const src = codeOf(WELFARE)
    assert.doesNotMatch(src, /to="\/welfare\/reports"/)
    assert.doesNotMatch(src, /to: '\/welfare\/reports'/)
  })

  it('the old funnel route redirects to the tabbed Visitors page', () => {
    const src = codeOf(FUNNEL_REDIRECT)
    assert.match(src, /middleware: 'staff'/)
    assert.match(src, /path: '\/visitors'/)
    assert.match(src, /tab: 'funnel'/)
    assert.match(src, /redirectCode: 301/)
  })

  it('the old reports route redirects to the tabbed Welfare page', () => {
    const src = codeOf(REPORTS_REDIRECT)
    assert.match(src, /middleware: \['staff', 'welfare'\]/)
    assert.match(src, /path: '\/welfare'/)
    assert.match(src, /tab: 'reports'/)
    assert.match(src, /redirectCode: 301/)
  })

  it('the funnel panel keeps the funnel queries and export (moved surface only)', () => {
    const src = codeOf(FUNNEL_PANEL)
    assert.match(src, /\/api\/visitors\/funnel/)
    assert.match(src, /\/api\/visitors\/funnel\.csv/)
    assert.match(src, /visitors-funnel-branches/)
  })

  it('the reports panel keeps the reports queries and export (moved surface only)', () => {
    const src = codeOf(REPORTS_PANEL)
    assert.match(src, /\/api\/welfare\/reports/)
    assert.match(src, /\/api\/welfare\/reports\.csv/)
    assert.match(src, /welfare-report-branches/)
  })

  it('the welfare gate still guards the tabbed page', () => {
    const src = codeOf('apps/web/middleware/welfare.ts')
    assert.match(src, /welfareCases/)
    const page = codeOf(WELFARE)
    assert.match(page, /middleware: \['staff', 'welfare'\]/)
  })
})
