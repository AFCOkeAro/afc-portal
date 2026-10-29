/**
 * AFC-896 contract — Time Off + Annual Leave merged as tabs.
 *
 * Time off and annual leave are the same subject, so they share one section
 * (balances / requests / approvals tabs) instead of separate menu entries.
 * No new registers: the tabs only move surfaces. Balances math (AFC-854)
 * and the approval flow (AFC-842) ride unchanged underneath.
 *
 * Run: node --test tests/web/time-off-tabs.contract.mjs
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
const PAGE = 'apps/web/pages/time-off.vue'
const REDIRECT = 'apps/web/pages/annual-leave.vue'

describe('AFC-896 merged nav: one Time Off section, no Annual Leave duplicate', () => {
  const src = read(NAV)

  it('has exactly one Time Off entry pointing at /time-off', () => {
    const hits = src.match(/label: 'Time Off'/g) ?? []
    assert.equal(hits.length, 1, `expected 1 Time Off entry, found ${hits.length}`)
    assert.match(src, /to: '\/time-off'/)
  })

  it('removes the separate Annual Leave menu entry', () => {
    assert.doesNotMatch(src, /label: 'Annual Leave'/)
    assert.doesNotMatch(src, /to: '\/annual-leave'/)
  })

  it('keeps the merged entry under Church Office', () => {
    const needle = "to: '/time-off',"
    const at = src.indexOf(needle)
    assert.ok(at !== -1, '/time-off is still a nav target')
    const slice = src.slice(at, at + 400)
    assert.match(slice, /group: 'office'/)
  })
})

describe('AFC-896 merged tabs: balances / requests / approvals with ?tab= links', () => {
  const src = read(PAGE)

  it('declares the three tabs (balances, requests, approvals)', () => {
    for (const id of ["'balances'", "'requests'", "'approvals'"]) {
      assert.match(src, new RegExp(`id: ${id}`, 'g'), `tab ${id} present`)
    }
  })

  it('deep-links each tab through ?tab= like the events detail precedent', () => {
    assert.match(src, /route\.query\.tab/)
    assert.match(src, /router\.replace/)
    assert.match(src, /tab: next/)
  })

  it('renders one section per tab with its own labelled region', () => {
    for (const label of ['Leave balances', 'Leave requests', 'Leave approvals']) {
      assert.match(src, new RegExp(`aria-label="${label}"`), `${label} section present`)
    }
  })

  it('gates each tab by its own read grant (scope-aware, fail-closed)', () => {
    assert.match(src, /canSeeBalances/)
    assert.match(src, /canSeeRequests/)
    assert.match(src, /leaveBalances.*read|COLLECTIONS\.leaveBalances/)
    assert.match(src, /leaveRequests.*read|COLLECTIONS\.leaveRequests/)
  })

  it('focuses the pending queue and the decided list without a new endpoint', () => {
    assert.match(src, /pendingRequests/)
    assert.match(src, /decidedRequests/)
    assert.match(src, /row\.status === 'pending'/)
    assert.doesNotMatch(src, /\/api\/leave-approvals/)
  })
})

describe('AFC-896 surfaces moved, behaviour kept', () => {
  const src = codeOf(PAGE)

  it('balances math still rides the page (AFC-854 unchanged)', () => {
    assert.match(src, /workingDaysBetween/)
    assert.match(src, /setAllowance/)
    assert.match(src, /removeBalance/)
    assert.match(src, /used_days/)
    assert.match(src, /remaining_days/)
    assert.match(
      src,
      /previewBalance\.allowance - previewBalance\.used - previewDays/,
      'remaining-after math shown',
    )
  })

  it('the approval flow still files, decides and withdraws (AFC-842 unchanged)', () => {
    assert.match(src, /createRequest/)
    assert.match(src, /decide\(row\.id, 'approved'\)/)
    assert.match(src, /decide\(row\.id, 'declined'\)/)
    assert.match(src, /decide\(row\.id, 'cancelled'\)/)
    assert.match(src, /withdraw\(row\.id\)/)
  })
})

describe('AFC-896 old route: /annual-leave redirects into the Requests tab', () => {
  it('/annual-leave lands on /time-off?tab=requests', () => {
    const src = codeOf(REDIRECT)
    assert.match(src, /\/time-off/)
    assert.match(src, /requests/)
    assert.match(src, /navigateTo/)
    assert.match(src, /301/)
  })
})
