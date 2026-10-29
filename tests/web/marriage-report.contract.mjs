/**
 * AFC-680 contract tests — marriage phase E (report of conducted marriages).
 *
 * Static gates over the report layer (the DB suite 96 owns the report
 * columns on migration 0035; this suite owns the route + page rules a
 * crafted HTTP request must not skip):
 *   1. Report route: conducted filter (stage = reported), scoped reads
 *      (branch/zone isolation, fail-closed), restricted fields via the
 *      shared matrix (policy withholds, portal strips).
 *   2. Report columns: brother/sister names, location (church in DB =
 *      branch), date, officiating minister, Bible passage, certificate
 *      type, scanned certificate, couple photo, presentation photo.
 *   3. Hygiene: failure shape {code, fields}, no bare 500; brother/sister
 *      language in ALL UI; EntitySelect only on the pipeline pages.
 *
 * Run: node --test tests/web/marriage-report.contract.mjs
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

const ROUTE = 'apps/web/server/api/marriage-cases/report.get.ts'
// AFC-898: the report surface moved into the Report tab of the merged
// /marriage page; the old report route is a deep-link redirect stub.
const PAGE = 'apps/web/pages/marriage/index.vue'
const REDIRECT_PAGE = 'apps/web/pages/marriage-cases/report.vue'

describe('marriage report — conducted filter with scoped reads', () => {
  it('lists only reported cases behind the marriage_cases read gate', () => {
    const src = codeOf(ROUTE)
    assert.match(
      src,
      /requireCan\(scope, 'marriage_cases', 'read'\)/,
      'report read is gated',
    )
    assert.match(src, /stage.*reported|reported.*stage/, 'conducted = reported filter')
  })

  it('isolates branches and zones, failing closed', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /officeBranchScope\(scope\)/, 'branch isolation applied')
    assert.match(src, /officeZoneScope\(scope\)/, 'zone isolation applied')
    assert.match(src, /logScopedQuery/, 'scoped reads are logged')
  })

  it('strips restricted fields per the shared matrix (policy withholds, portal strips)', () => {
    const src = codeOf(ROUTE)
    assert.match(
      src,
      /visibleFields\(scope, 'marriage_cases'/,
      'field projection via matrix',
    )
    assert.match(
      src,
      /stripHiddenMany\(scope, 'marriage_cases'/,
      'rows stripped via matrix',
    )
  })
})

describe('marriage report — conducted-marriage columns', () => {
  it('the route projects every report column from migration 0035', () => {
    const src = codeOf(ROUTE)
    for (const field of [
      'brother_person',
      'sister_person',
      'branch',
      'wedding_date',
      'officiating_minister',
      'bible_passage',
      'certificate_type',
      'marriage_certificate_file',
      'couple_photo_file',
      'presentation_photo_file',
    ]) {
      assert.match(src, new RegExp(field), `report projects ${field}`)
    }
  })

  it('the route enriches brother/sister/branch/minister display names', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /brother_name/, 'brother display name enriched')
    assert.match(src, /sister_name/, 'sister display name enriched')
    assert.match(src, /branch_name/, 'branch (church) display name enriched')
    assert.match(src, /officiating_minister_name/, 'minister display name enriched')
  })

  it('the page shows every report column with brother/sister language', () => {
    const text = read(PAGE)
    assert.match(text, /Conducted marriages/, 'page names conducted marriages')
    assert.match(text, /Brother/, 'brother column named')
    assert.match(text, /Sister/, 'sister column named')
    assert.match(text, /Church \(branch\)/, 'location named as church in DB')
    assert.match(text, /Wedding date/, 'wedding date column named')
    assert.match(text, /Officiating minister/, 'minister column named')
    assert.match(text, /Bible passage/, 'passage column named')
    assert.match(text, /Certificate/, 'certificate column named')
    assert.match(text, /Scanned certificate/, 'scanned certificate column named')
    assert.match(text, /Couple photo/, 'couple photo column named')
    assert.match(text, /Presentation photo/, 'presentation photo column named')
  })

  it('the old report route redirects into the merged Report tab', () => {
    const text = read(REDIRECT_PAGE)
    assert.match(text, /navigateTo/, 'old report route redirects')
    assert.match(text, /path: '\/marriage'/, 'redirect lands on the merged page')
    assert.match(text, /tab: 'report'/, 'redirect pre-selects the Report tab')
  })
})

describe('marriage report — failure shape and language hygiene', () => {
  it('names the failure shape, never a bare 500', () => {
    const src = read(ROUTE)
    assert.match(
      src,
      /code: 'pending_migration_0035'/,
      'missing store names migration 0035',
    )
    assert.doesNotMatch(
      codeOf(ROUTE),
      /throw new Error\(/,
      'no bare Error (h3 renders 500)',
    )
    const text = read(PAGE)
    assert.match(text, /Could not load the report/, 'page explains report failures')
  })

  it('no groom/bride language in the report surface', () => {
    for (const rel of [ROUTE, PAGE]) {
      assert.doesNotMatch(codeOf(rel), /groom/i, `${rel}: brother/sister language only`)
      assert.doesNotMatch(codeOf(rel), /bride/i, `${rel}: brother/sister language only`)
    }
  })
})
