/**
 * AFC-842 contract — Annual Leave under Church Office + leave requests.
 *
 * One register (requester, inclusive day count stamped server-side,
 * closed type/status sets, decisions ride the same row). The menu lives
 * under Church Office; capabilities travel with the entry.
 *
 * Run: node --test tests/web/annual-leave.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261028_0052_leave_requests.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0052_leave_requests.down.sql'
const NAV = 'apps/web/utils/navigation.ts'
const PAGE = 'apps/web/pages/annual-leave.vue'

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

describe('AFC-842 leave register', () => {
  it('creates the requests table with closed type and status sets', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS leave_requests/)
    assert.match(src, /compassionate/)
    assert.match(src, /cancelled/)
    assert.match(src, /end_date >= start_date/, 'end never precedes start')
  })

  it('grants the file/decide verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON leave_requests TO directus_app/)
    assert.match(src, /GRANT INSERT \(branch, zone, person, start_date/)
    assert.match(src, /GRANT DELETE ON leave_requests TO directus_app/)
    assert.match(src, /REVOKE ALL ON leave_requests FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back leave requests/)
    assert.match(src, /DROP TABLE IF EXISTS leave_requests/)
  })
})

describe('AFC-842 leave page and nav', () => {
  it('Annual Leave lives under Church Office', () => {
    const src = codeOf(NAV)
    assert.equal(groupOf(src, '/annual-leave'), 'office')
    assert.match(src, /requires: \['leave_requests', 'read'\]/)
  })

  it('the page files, corrects and decides with transitions', () => {
    const src = codeOf(PAGE)
    assert.match(src, /createRequest/)
    assert.match(src, /decide\(row\.id, 'approved'\)/)
    assert.match(src, /withdraw\(row\.id\)/)
  })

  it('decisions stamp the decider and follow the transition table', () => {
    const src = codeOf('apps/web/server/api/leave-requests/[id].patch.ts')
    assert.match(src, /TERMINAL/)
    assert.match(src, /decided_by: scope\.session\.user\.id/)
    assert.match(src, /invalid_transition/)
  })
})
