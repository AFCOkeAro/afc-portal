/**
 * AFC-838 contract — Office Admin splits into Church Office / Family / Finance.
 *
 * The Office Admin section is renamed Church Office; Marriage (+ pipeline +
 * report) moves under a Family section; monetary entries move under Finance.
 * No entry changes its capability: whoever could see an item still can, the
 * section header is what moved.
 *
 * Run: node --test tests/web/office-sections.contract.mjs
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

function groupOf(src, to) {
  // Group headers also carry `to:` — take the item entry (the one whose
  // following block names a group).
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

describe('AFC-838 office sections', () => {
  it('renames Office Admin to Church Office and adds Family + Finance', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'Church Office'/)
    assert.doesNotMatch(src, /Office Admin/)
    assert.match(src, /key: 'family'/)
    assert.match(src, /key: 'finance'/)
  })

  it('marriage entries live under Family', () => {
    const src = codeOf(NAV)
    assert.equal(groupOf(src, '/marriage'), 'family')
    assert.equal(groupOf(src, '/marriage-cases'), 'family')
    assert.equal(groupOf(src, '/marriage-cases/report'), 'family')
  })

  it('monetary entries live under Finance', () => {
    const src = codeOf(NAV)
    assert.equal(groupOf(src, '/finance/records'), 'finance')
    assert.equal(groupOf(src, '/finance/formulas'), 'finance')
    assert.equal(groupOf(src, '/finance/returns'), 'finance')
    assert.equal(groupOf(src, '/finance/summary'), 'finance')
    // AFC-839: transfers moved to Church Office (chairman direction
    // supersedes the AFC-838 placement); the gate travels with it.
    assert.equal(groupOf(src, '/transfers'), 'office')
  })

  it('capability gates travel with their entries', () => {
    const src = codeOf(NAV)
    assert.match(src, /requires: \['marriage_matters', 'read'\]/)
    assert.match(src, /requires: \['marriage_cases', 'read'\]/)
    assert.match(src, /requires: \['branch_financial_records', 'read'\]/)
    assert.match(src, /requires: \['transfers', 'read'\]/)
  })
})
