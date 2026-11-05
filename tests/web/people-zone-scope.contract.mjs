/**
 * AFC-1078 follow-up — cross-module people.zone guard.
 *
 * people carries branch only (hierarchy 0002 adds no zone column; Person
 * type carries branch only). Any server read that selects `zone` from the
 * `people` collection makes Directus 403 with directus_forbidden, which the
 * UI collapses into the generic "You do not have access to that." Zone for
 * a person always derives via branches (see people-summary.ts).
 *
 * Run: node --test tests/web/people-zone-scope.contract.mjs
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

describe('AFC-1078 cross-module people.zone guard', () => {
  it('people-compare derives zone via branches, never selects people.zone', () => {
    const src = codeOf('apps/web/server/utils/people-compare.ts')
    assert.doesNotMatch(src, /zoneScopeFilter/)
    // The people read (not the prior_year_import_items read, whose table
    // genuinely carries zone) must not request zone. Scope the check to
    // the fields array of the people query.
    const at = src.indexOf("'people'")
    assert.ok(at !== -1, 'people read is still present')
    const queryOpts = src.slice(at, at + 400)
    const fieldsMatch = queryOpts.match(/fields: \[([^\]]*)\]/)
    assert.ok(fieldsMatch, 'people read still declares fields')
    assert.doesNotMatch(fieldsMatch[1], /zone/)
    assert.match(fieldsMatch[1], /'branch'/)
    assert.match(fieldsMatch[1], /'status'/)
    assert.match(src, /branches/)
  })

  it('leave-balances allowance route never selects people.zone', () => {
    const src = codeOf('apps/web/server/api/leave-balances/index.post.ts')
    assert.doesNotMatch(src, /person\.zone/)
    assert.match(src, /fields: \['id', 'branch'\]/)
  })

  it('member profile never selects people.zone', () => {
    const src = codeOf('apps/web/server/api/member/profile.get.ts')
    assert.doesNotMatch(src, /branch,zone/)
    assert.doesNotMatch(src, /row\.zone/)
  })
})
