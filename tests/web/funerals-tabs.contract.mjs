/**
 * AFC-1024 contract — funerals tabbed index under Family (AFC-899 tabs on
 * the AFC-884 register).
 *
 * One Family sidebar entry; the index carries the tabbed sub-menu
 * (cases / paper trail / programme / dates & attendance) with ?tab=
 * deep-linking. Cases is the default tab and keeps the list + new-case
 * modal; the other tabs reuse the same list rows and link into the
 * detail-page tabs. No new migration, no role-matrix change.
 *
 * Run: node --test tests/web/funerals-tabs.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('AFC-1024 funerals nav entry', () => {
  it('is exactly one sidebar entry under Family', () => {
    const src = codeOf('apps/web/utils/navigation.ts')
    const hits = src.match(/to: '\/funerals'/g) ?? []
    assert.equal(hits.length, 1, `expected 1 funerals nav entry, found ${hits.length}`)
    assert.match(src, /group: 'family'/)
    assert.match(src, /label: 'Funerals'/)
    assert.match(src, /icon: 'i-lucide-cross'/)
    assert.match(src, /funeral_cases.*read/)
  })
})

describe('AFC-1024 funerals tabbed index', () => {
  it('has four tabs with ?tab= sync and cases as default', () => {
    const src = codeOf('apps/web/pages/funerals/index.vue')
    assert.match(src, /role="tablist"/, 'index sub-menu is tabbed')
    assert.match(src, /route\.query\.tab/, '?tab= deep-linking')
    assert.match(src, /router\.replace/, 'tab switches replace the query')
    for (const tab of ['cases', 'papers', 'programme', 'dates']) {
      assert.match(src, new RegExp(`['"]${tab}['"]`), `tab ${tab} exists`)
      assert.match(
        src,
        new RegExp(`v-if="tab === '${tab}'"`),
        `tab ${tab} renders a section`,
      )
    }
    assert.match(src, /: 'cases'/, 'cases is the fallback tab')
  })

  it('cases tab keeps the list + new-case modal', () => {
    const src = codeOf('apps/web/pages/funerals/index.vue')
    assert.match(src, /Open a funeral case/, 'list opens cases')
    assert.match(src, /New funeral/, 'new-case action stays')
  })

  it('other tabs reuse list rows and link into the case tabs', () => {
    const src = codeOf('apps/web/pages/funerals/index.vue')
    assert.match(src, /\?tab=papers/, 'paper trail links into the case')
    assert.match(src, /\?tab=programme/, 'programme links into the case')
    assert.match(src, /\?tab=dates/, 'dates links into the case')
    assert.doesNotMatch(src, /\/api\/(papers|programme|dates)/, 'no new endpoints')
  })
})

describe('AFC-1024 merge gate', () => {
  it('adds no new migration file beyond 0062', () => {
    const dir = path.join(root, 'services/directus/schema/migrations')
    const names = readdirSync(dir).filter((n) => n.endsWith('.sql'))
    const funeral = names.filter((n) => n.toLowerCase().includes('funeral'))
    assert.deepEqual(
      funeral,
      ['20261029_0062_funerals.sql'],
      `only the 0062 funeral migration, found ${funeral}`,
    )
  })

  it('adds no role-matrix change beyond the 884 funeral entry', () => {
    const src = codeOf('packages/shared/src/role-matrix.ts')
    const hits = src.match(/funeralCases/g) ?? []
    assert.equal(hits.length, 1, `single funeralCases matrix entry, found ${hits.length}`)
  })
})
