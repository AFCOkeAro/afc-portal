/**
 * AFC-898 contract tests — Marriage merged with pipeline and report.
 *
 * Marriage, the marriage pipeline and the marriage report are one subject, so
 * they share a single section with tabs instead of three menu entries. Static
 * gates over the merge (the pipeline/report/phase-B-F suites own the stage
 * and query rules; this suite owns the merge rules a careless edit must not
 * skip):
 *   1. Navigation carries exactly one sidebar Marriage entry (-> /marriage,
 *      Family); the pipeline/report duplicates are gone; capability gates
 *      travel with the entry.
 *   2. The /marriage hub has Matters | Pipeline | Report tabs deep-linked by
 *      ?tab=, each tab gated by its own read grant; all three surfaces moved
 *      here with the same API calls, forms, tables and columns.
 *   3. The old /marriage-cases and /marriage-cases/report routes stay as
 *      staff-gated deep-link redirects into their tab (churches-merge
 *      precedent), never a second truth for the list UI.
 *   4. Detail routes are untouched; their back-links land on the hub (report
 *      tab included). Brother/sister language throughout, EntitySelect only.
 *
 * Run: node --test tests/web/marriage-merged.contract.mjs
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
const HUB = 'apps/web/pages/marriage/index.vue'
const PIPELINE_REDIRECT = 'apps/web/pages/marriage-cases/index.vue'
const REPORT_REDIRECT = 'apps/web/pages/marriage-cases/report.vue'
const MATTER_DETAIL = 'apps/web/pages/marriage/[id].vue'
const CASE_DETAIL = 'apps/web/pages/marriage-cases/[id].vue'

describe('marriage merge — single sidebar entry', () => {
  it('has exactly one sidebar Marriage entry pointing at /marriage', () => {
    const src = read(NAV)
    const hits = src.match(/label: 'Marriage'/g) ?? []
    assert.equal(hits.length, 1, `expected 1 Marriage entry, found ${hits.length}`)
    assert.match(src, /to: '\/marriage'/)
  })

  it('removes the pipeline/report menu duplicates, keeping Family placement', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /Marriage pipeline/, 'no pipeline menu entry')
    assert.doesNotMatch(src, /Marriage report/, 'no report menu entry')
    assert.doesNotMatch(src, /marriage-cases/, 'no marriage-cases nav target')
    assert.match(src, /group: 'family'/, 'Marriage stays under Family')
  })

  it('keeps the marriage capability gates on the entry', () => {
    const src = read(NAV)
    assert.match(src, /requires: \['marriage_matters', 'read'\]/)
  })
})

describe('marriage merge — hub tabs', () => {
  it('offers Matters, Pipeline and Report tabs deep-linked by ?tab=', () => {
    const src = codeOf(HUB)
    for (const tab of ["'matters'", "'pipeline'", "'report'"]) {
      assert.match(src, new RegExp(tab), `tab ${tab} present`)
    }
    assert.match(src, /route\.query\.tab/, 'tab reads the query string')
    assert.match(src, /router\.replace/, 'tab switches replace the query')
    assert.match(src, /aria-current/, 'active tab is exposed to assistive tech')
  })

  it('gates each tab by its own read grant', () => {
    const src = codeOf(HUB)
    assert.match(src, /can\(COLLECTIONS\.marriageMatters/, 'matters tab gated')
    assert.match(src, /can\(COLLECTIONS\.marriageCases/, 'pipeline/report tabs gated')
  })

  it('moved every surface with the same API calls', () => {
    const src = codeOf(HUB)
    assert.match(src, /'\/api\/marriage'/, 'matters list call kept')
    assert.match(src, /api\.post\('\/api\/marriage'/, 'matters create call kept')
    assert.match(src, /'\/api\/marriage-cases'/, 'pipeline list call kept')
    assert.match(src, /api\.post\('\/api\/marriage-cases'/, 'pipeline create call kept')
    assert.match(src, /'\/api\/marriage-cases\/report'/, 'report query kept')
    assert.match(src, /limit: 100/, 'report page size kept')
  })

  it('moved every surface with the same actions, forms and columns', () => {
    const src = read(HUB)
    assert.match(src, /Record matter/, 'matters action kept')
    assert.match(src, /New matter/, 'matters form kept')
    assert.match(src, /Open case/, 'pipeline action kept')
    assert.match(src, /New couple/, 'pipeline form kept')
    assert.match(src, /Marriages conducted/, 'report header kept')
    assert.match(src, /Conducted marriages/, 'report section kept')
    assert.match(src, /Officiating minister/, 'report columns kept')
    assert.match(src, /Could not load the report/, 'report failure text kept')
  })
})

describe('marriage merge — old routes redirect into their tab', () => {
  it('/marriage-cases redirects to the Pipeline tab', () => {
    const src = codeOf(PIPELINE_REDIRECT)
    assert.match(src, /navigateTo/, 'pipeline route redirects')
    assert.match(src, /path: '\/marriage'/, 'redirect lands on the merged page')
    assert.match(src, /tab: 'pipeline'/, 'redirect pre-selects the Pipeline tab')
    assert.match(src, /redirectCode: 301/, 'permanent redirect for bookmarks')
    assert.match(src, /middleware.*staff/, 'staff gate kept on the redirect')
  })

  it('/marriage-cases/report redirects to the Report tab', () => {
    const src = codeOf(REPORT_REDIRECT)
    assert.match(src, /navigateTo/, 'report route redirects')
    assert.match(src, /path: '\/marriage'/, 'redirect lands on the merged page')
    assert.match(src, /tab: 'report'/, 'redirect pre-selects the Report tab')
    assert.match(src, /redirectCode: 301/, 'permanent redirect for bookmarks')
    assert.match(src, /middleware.*staff/, 'staff gate kept on the redirect')
  })

  it('the redirects carry no list UI of their own', () => {
    for (const rel of [PIPELINE_REDIRECT, REPORT_REDIRECT]) {
      assert.doesNotMatch(codeOf(rel), /UTable/, `${rel}: no second table`)
      assert.doesNotMatch(codeOf(rel), /useAsyncData/, `${rel}: no second query`)
    }
  })
})

describe('marriage merge — details and language hygiene', () => {
  it('detail back-links land on the hub (pipeline via its tab)', () => {
    assert.match(read(MATTER_DETAIL), /to="\/marriage"/, 'matter detail returns to hub')
    assert.match(
      read(CASE_DETAIL),
      /to="\/marriage\?tab=pipeline"/,
      'case detail returns to the Pipeline tab',
    )
  })

  it('no groom/bride language anywhere on the merged surface', () => {
    for (const rel of [HUB, PIPELINE_REDIRECT, REPORT_REDIRECT, CASE_DETAIL]) {
      assert.doesNotMatch(codeOf(rel), /groom/i, `${rel}: brother/sister only`)
      assert.doesNotMatch(codeOf(rel), /bride/i, `${rel}: brother/sister only`)
    }
  })

  it('keeps EntitySelect for people/branch references', () => {
    assert.match(read(HUB), /EntitySelect/, 'hub uses EntitySelect')
  })
})
