/**
 * AFC-835 contract — headcount category set (defaults + add-more rows).
 *
 * The headcount form defaults to Adult/Youth/Children/Visitors where the
 * service type offers them, offers the remaining definition categories
 * through an add-row picker (with an Other label input), and lets rows be
 * removed. Ministers + altar workers are gone from every definition;
 * secretaries/senior_friends/spillover joined.
 *
 * Run: node --test tests/web/attendance-categories.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261028_0048_attendance_categories.sql'
/** SQL files use -- comments; strip them so prose cannot satisfy a pin. */
const sqlOf = (rel) => codeOf(rel).replace(/--[^\n]*/g, '')
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0048_attendance_categories.down.sql'
const PAGE = 'apps/web/pages/events/[id].vue'

describe('AFC-835 category set', () => {
  it('drops ministers + altar workers and adds the three new keys', () => {
    const src = sqlOf(MIGRATION)
    assert.doesNotMatch(src, /ministers|altar_workers/, 'no removed key in any set')
    assert.match(src, /secretaries/, 'secretaries seeded')
    assert.match(src, /senior_friends/, 'senior friends seeded')
    assert.match(src, /spillover/, 'spillover seeded')
  })

  it('the counts table CHECK evolves with the set', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /attendance_counts_category_check/, 'counts CHECK touched')
    assert.match(src, /secretaries/, 'new keys insertable at the table')
  })

  it('the rollback restores the exact 0003 arrays', () => {
    const src = codeOf(DOWN)
    assert.match(src, /ministers/, 'rollback restores the pre-835 sets')
  })

  it('the form defaults to the four rows and offers the rest as add-ons', () => {
    const src = codeOf(PAGE)
    assert.match(src, /UNIT_DEFAULT_CATS/, 'defaults named in one place')
    assert.match(src, /unitAddableCats/, 'add-row picker draws from the definition')
    assert.match(src, /unitRemoveCategory/, 'rows are removable')
    assert.match(src, /unitOtherLabel/, 'Other rows carry a label')
  })

  it('labels render human-readable names', () => {
    const src = codeOf(PAGE)
    assert.match(src, /unitCatLabel/, 'labels go through the formatter')
    assert.match(src, /AVS/, 'AVS keeps its acronym')
  })
})
