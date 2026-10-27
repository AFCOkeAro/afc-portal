/**
 * AFC-832 contract — task template picker + domain guard.
 *
 * The event tab offers the available-template list (no more one-button
 * apply), and POST /api/tasks/from-template fails closed when a template
 * is applied against another domain's record (marriage template on an
 * event, or vice versa).
 *
 * Run: node --test tests/web/task-templates.contract.mjs
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

const ROUTE = 'apps/web/server/api/tasks/from-template.post.ts'
const VIEWS = 'apps/web/components/TaskViews.vue'

describe('AFC-832 template picker + domain guard', () => {
  it('the event tab offers the available-template list', () => {
    const src = codeOf(VIEWS)
    assert.match(src, /TASK_TEMPLATES/, 'picker lists the code templates')
    assert.match(src, /templateOptions/, 'options derive from the registry')
    assert.match(src, /chosenTemplate/, 'the user picks before applying')
  })

  it('the route fails closed on cross-domain application', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /relatedType === 'event'/, 'event templates check events')
    assert.match(src, /relatedType === 'marriage'/, 'marriage templates check cases')
    assert.match(src, /template_domain_unknown/, 'unknown domains refuse loudly')
  })

  it('the unknown-template refusal stays', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /Unknown template/, 'no silent fallback to another template')
  })
})
