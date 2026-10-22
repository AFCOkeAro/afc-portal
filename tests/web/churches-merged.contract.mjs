/**
 * AFC-672 contract tests — merged Churches surface (zones + branches + BSC).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. List APIs return geo + contact fields (branches / zones / bscs) for the
 *     map and pin tooltips, with named fail-closed errors (never a bare 500).
 *  2. Navigation carries a single Churches entry; the admin Branches / Zones /
 *     Bible Study Centres duplicates are gone.
 *  3. The /churches page has a kind filter, a list/map toggle, per-pin
 *     tooltips with contact, a data-quality strip for missing geo (never
 *     plotted at 0,0), and the Area HQ = Oke-Aro rule.
 *  4. Entity references use the searchable EntitySelect (AFC-631) — no manual
 *     IDs. Old /branches and /zones routes redirect into the filtered view.
 *
 * Run: node --test tests/web/churches-merged.contract.mjs
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

describe('branches list: geo + contact, named fail-closed errors', () => {
  const src = codeOf('apps/web/server/api/branches.get.ts')

  for (const field of ['geo_lat', 'geo_lng', 'address', 'phone', 'email', 'pastor']) {
    it(`requests ${field}`, () => {
      assert.match(src, new RegExp(`'${field}'`), `field ${field} requested`)
    })
  }

  it('fails closed with named errors, never a bare 500', () => {
    assert.match(src, /throwStoreUnavailable/)
    assert.match(src, /branch_store/)
    assert.match(src, /0002/)
    assert.match(src, /statusCode/)
  })

  it('lets deliberate 4xx pass through untouched', () => {
    assert.match(src, /throw error/)
  })
})

describe('zones list: geo + contact, named fail-closed errors', () => {
  const src = codeOf('apps/web/server/api/zones.get.ts')

  for (const field of ['geo_lat', 'geo_lng', 'address', 'leader']) {
    it(`requests ${field}`, () => {
      assert.match(src, new RegExp(`'${field}'`), `field ${field} requested`)
    })
  }

  it('fails closed with named errors, never a bare 500', () => {
    assert.match(src, /throwStoreUnavailable/)
    assert.match(src, /zone_store/)
  })
})

describe('bscs list: geo + contact, named fail-closed errors', () => {
  const src = codeOf('apps/web/server/api/bscs.get.ts')

  for (const field of ['geo_lat', 'geo_lng', 'address', 'location', 'leader']) {
    it(`requests ${field}`, () => {
      assert.match(src, new RegExp(`'${field}'`), `field ${field} requested`)
    })
  }

  it('fails closed with named errors, never a bare 500', () => {
    assert.match(src, /throwStoreUnavailable/)
    assert.match(src, /bsc_store/)
    assert.match(src, /0002/)
  })
})

describe('navigation: single Churches entry', () => {
  const src = read('apps/web/utils/navigation.ts')

  it('has exactly one sidebar Churches entry pointing at /churches', () => {
    const hits = src.match(/label: 'Churches'/g) ?? []
    assert.equal(hits.length, 1, `expected 1 Churches entry, found ${hits.length}`)
    assert.match(src, /to: '\/churches'/)
  })

  it('removes the admin Branches / Zones / Bible Study Centres duplicates', () => {
    assert.doesNotMatch(src, /label: 'Branches'/)
    assert.doesNotMatch(src, /label: 'Zones'/)
    assert.doesNotMatch(src, /label: 'Bible Study Centres'/)
  })
})

describe('churches page: filter, map, tooltips, data quality', () => {
  const src = codeOf('apps/web/pages/churches/index.vue')

  it('offers the All/Zones/Branches/BSC kind filter', () => {
    for (const value of ["'all'", "'zones'", "'branches'", "'bscs'"]) {
      assert.match(src, new RegExp(value), `kind ${value} present`)
    }
  })

  it('uses the searchable EntitySelect for the zone filter (no manual IDs)', () => {
    assert.match(src, /EntitySelect/)
    assert.doesNotMatch(src, /manual/)
  })

  it('has a list/map toggle', () => {
    assert.match(src, /list/)
    assert.match(src, /map/)
  })

  it('pins Area HQ as Oke-Aro and never invents zonal coordinates', () => {
    assert.match(src, /OKE-ARO/)
    assert.match(src, /never invented|not invented/i)
  })

  it('shows contact in tooltips and the detail card', () => {
    assert.match(src, /contact/)
    assert.match(src, /address/)
  })

  it('lists missing-geo rows in a data-quality strip, never at 0,0', () => {
    assert.match(src, /missingGeo|without coordinates/)
    assert.match(src, /0,0/)
  })

  it('gates each kind by its own read grant (scope-aware, fail-closed)', () => {
    assert.match(src, /can\(COLLECTIONS\.branches/)
    assert.match(src, /can\(COLLECTIONS\.zones/)
    assert.match(src, /can\(COLLECTIONS\.bibleStudyCentres/)
  })
})

describe('old routes: deep-link redirects into the filtered view', () => {
  it('/branches redirects to /churches?kind=branches', () => {
    const src = codeOf('apps/web/pages/branches/index.vue')
    assert.match(src, /\/churches/)
    assert.match(src, /branches/)
    assert.match(src, /navigateTo/)
  })

  it('/zones redirects to /churches?kind=zones', () => {
    const src = codeOf('apps/web/pages/zones/index.vue')
    assert.match(src, /\/churches/)
    assert.match(src, /zones/)
    assert.match(src, /navigateTo/)
  })
})
