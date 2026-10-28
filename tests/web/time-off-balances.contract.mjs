/**
 * AFC-854 phase 1 contract — Time Off allowances + working-day count.
 *
 * One allowance row per person per year; a shared working-day counter
 * (weekends skipped); a Time Off page with the allowance book and a
 * planning calculator. Used/remaining days compute against
 * leave_requests in phase 2, once that slice has landed.
 *
 * Run: node --test tests/web/time-off-balances.contract.mjs
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
const sqlOf = (rel) => codeOf(rel).replace(/--[^\n]*/g, '')

const MIGRATION = 'services/directus/schema/migrations/20261028_0055_leave_balances.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0055_leave_balances.down.sql'
const NAV = 'apps/web/utils/navigation.ts'

function groupOf(src, to) {
  const needle = `to: '${to}',`
  let from = 0
  for (;;) {
    const at = src.indexOf(needle, from)
    assert.ok(at !== -1, `${to} is still a nav target`)
    const slice = src.slice(at, at + 400)
    const m = slice.match(/group: '([a-z]+)'/)
    if (m) return m[1]
    from = at + needle.length
  }
}

describe('AFC-854 balances register', () => {
  it('creates the allowance table with one row per person per year', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS leave_balances/)
    assert.match(src, /UNIQUE \(person, year\)/)
    assert.match(src, /allowance_days/)
  })

  it('grants the allowance verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON leave_balances TO directus_app/)
    assert.match(src, /GRANT INSERT \(person, year, allowance_days/)
    assert.match(src, /GRANT DELETE ON leave_balances TO directus_app/)
    assert.match(src, /REVOKE ALL ON leave_balances FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back leave balances/)
    assert.match(src, /DROP TABLE IF EXISTS leave_balances/)
  })
})

describe('AFC-854 time-off page and nav', () => {
  it('Time Off lives under Church Office', () => {
    const src = codeOf(NAV)
    assert.equal(groupOf(src, '/time-off'), 'office')
    assert.match(src, /requires: \['leave_balances', 'read'\]/)
  })

  it('the page manages allowances and counts working days', () => {
    const src = codeOf('apps/web/pages/time-off.vue')
    assert.match(src, /workingDaysBetween/)
    assert.match(src, /setAllowance/)
    assert.match(src, /removeBalance/)
  })

  it('the counter skips weekends and fails closed on bad input', () => {
    const src = codeOf('packages/shared/src/leave.ts')
    assert.match(src, /getUTCDay/)
    assert.match(src, /return null/)
  })

  it('balance routes scope-gate through the person', () => {
    const src = codeOf('apps/web/server/api/leave-balances/index.post.ts')
    assert.match(src, /findScopedItem/)
    assert.match(src, /duplicate_allowance/)
  })
})
