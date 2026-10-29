/**
 * AFC-900 contract — AVS tabs: Secretaries + Outreach List.
 *
 * Secretaries is the list of AVS secretaries, so it belongs as a tab
 * inside AVS — not routed under departments. Outreach List is the
 * locations visited (the outreach_locations register on /avs) — not the
 * /visitors newcomer route, which stays owned by Welfare. No new
 * registers: assignment logic and queries are unchanged, only the surface
 * moves; nav entries point at the right registers.
 *
 * Run: node --test tests/web/avs-tabs.contract.mjs
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
const PAGE = 'apps/web/pages/avs.vue'

describe('AFC-900 AVS tabs', () => {
  it('the page carries Outreach List + Secretaries tabs', () => {
    const src = codeOf(PAGE)
    assert.match(src, /label: 'Outreach List'/)
    assert.match(src, /label: 'Secretaries'/)
  })

  it('tabs deep-link through ?tab= (events detail precedent)', () => {
    const src = codeOf(PAGE)
    assert.match(src, /route\.query\.tab/)
    assert.match(src, /router\.replace\(\{ query: \{ \.\.\.route\.query, tab:/)
  })

  it('the Outreach List tab is the visited-locations register, not /visitors', () => {
    const src = codeOf(PAGE)
    assert.match(src, /OUTREACH_LOCATION_CATEGORIES/)
    assert.doesNotMatch(src, /to="\/visitors"/)
  })

  it('secretary assignment logic is unchanged, only the surface moved', () => {
    const src = codeOf(PAGE)
    assert.match(src, /assignSecretary/)
    assert.match(src, /unassignSecretary/)
    assert.match(src, /\/api\/outreach-locations\/.*\/secretaries/)
  })
})

describe('AFC-900 nav cleanup', () => {
  it('no standalone Secretaries entry is routed under departments', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /label: 'Secretaries'/)
  })

  it('Outreach List routes to /avs, not /visitors', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'Outreach List',\s*\n\s*to: '\/avs'/)
    assert.doesNotMatch(src, /label: 'Outreach List',\s*\n\s*to: '\/visitors'/)
  })

  it('AVS stays the canonical outreach entry on /avs', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'AVS',\s*\n\s*to: '\/avs'/)
  })

  it('the real owners keep their routes (no over-deletion)', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'Visitors',\s*\n\s*to: '\/visitors'/)
    assert.match(src, /label: 'Departments',\s*\n\s*to: '\/departments'/)
    assert.match(src, /label: 'Groups',\s*\n\s*to: '\/departments'/)
  })

  it('Outreach List travels on the outreach_locations grant, not visitors', () => {
    const src = codeOf(NAV)
    const at = src.indexOf("label: 'Outreach List'")
    assert.ok(at !== -1)
    const slice = src.slice(at, at + 300)
    assert.match(slice, /requires: \['outreach_locations', 'read'\]/)
  })
})
