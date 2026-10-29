/**
 * AFC-839 contract — nav batch: no My tasks, funnel under Welfare,
 * transfers under Church Office.
 *
 * /tasks already carries the Assigned to me checkbox, so the My tasks
 * entry is a second truth to maintain. The funnel is a welfare working
 * list; transfers are Church Office moves. Capabilities travel with the
 * entries (no grant changes).
 *
 * Run: node --test tests/web/nav-batch-839.contract.mjs
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

describe('AFC-839 nav batch', () => {
  it('has no My tasks entry (the tasks page checkbox covers it)', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /My tasks/)
    assert.doesNotMatch(src, /tasks\?mine=1/)
  })

  // AFC-895 supersedes this pin: the funnel is a tab on /visitors
  // (deep-link /visitors?tab=funnel), not a nav entry. The old
  // /visitors/funnel route redirects to that tab.
  it('the funnel has no standalone entry (it is a tab on /visitors)', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /Visitor funnel/)
    assert.doesNotMatch(src, /visitors\/funnel/)
  })

  it('transfers live under Church Office', () => {
    const src = codeOf(NAV)
    assert.equal(groupOf(src, '/transfers'), 'office')
  })

  it('capability gates travel with their entries', () => {
    const src = codeOf(NAV)
    assert.match(src, /requires: \['visitors', 'read'\]/)
    assert.match(src, /requires: \['transfers', 'read'\]/)
  })
})
