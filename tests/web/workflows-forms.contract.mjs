/**
 * AFC-840 contract — dedicated Workflows and Forms pages, linked separately.
 *
 * The Workflow and Automation placeholder (pointing at /tasks) is replaced
 * by a template-catalogue page and a forms-hub page. Templates live in code
 * and apply through the existing from-template endpoint; the hub cards gate
 * on their own create grants.
 *
 * Run: node --test tests/web/workflows-forms.contract.mjs
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
const WORKFLOWS = 'apps/web/pages/workflows.vue'
const FORMS = 'apps/web/pages/forms.vue'

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

describe('AFC-840 workflows and forms', () => {
  it('links both pages separately under Church Office', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /Workflow and Automation/)
    assert.equal(groupOf(src, '/workflows'), 'office')
    assert.equal(groupOf(src, '/forms'), 'office')
  })

  it('the workflows page catalogues code templates and applies them', () => {
    const src = codeOf(WORKFLOWS)
    assert.match(src, /TASK_TEMPLATES/)
    assert.match(src, /\/api\/tasks\/from-template/)
    assert.match(src, /COLLECTIONS.tasks/)
  })

  it('the forms hub gates each card on its own create grant', () => {
    const src = codeOf(FORMS)
    assert.match(src, /visibleCards/)
    assert.match(src, /permissions\.can/)
    assert.match(src, /\/register/)
  })
})
