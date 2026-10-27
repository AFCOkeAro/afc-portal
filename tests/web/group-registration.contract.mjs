/**
 * AFC-837 contract — branch member tick-list for mass registration.
 *
 * The group modal lists directory members of the chosen branch (details
 * the portal already holds) with tick boxes; ticked rows append prefilled
 * and editable. The submit path is unchanged (per-member validation,
 * idempotent replays).
 *
 * Run: node --test tests/web/group-registration.contract.mjs
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

const MODAL = 'apps/web/components/RegistrationGroupModal.vue'

describe('AFC-837 branch member tick-list', () => {
  it('loads directory members for the batch branch', () => {
    const src = codeOf(MODAL)
    assert.match(src, /loadBranchMembers/, 'branch members load per batch branch')
    assert.match(src, /\/api\/people/, 'members come from the people directory')
    assert.match(src, /branch: branchId/, 'scoped to the chosen branch')
  })

  it('ticked rows append prefilled without changing the submit path', () => {
    const src = codeOf(MODAL)
    assert.match(src, /addTicked/, 'ticked rows append as member rows')
    assert.match(src, /personId/, 'directory link stays client-side only')
    assert.match(
      src,
      /group-registrations/,
      'submit still goes through group-registrations',
    )
  })
})
