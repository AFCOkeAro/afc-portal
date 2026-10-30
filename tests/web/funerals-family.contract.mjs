/**
 * AFC-884 contract — funerals under Family.
 *
 * A funeral links a person (flipping them to deceased, route-owned) or
 * names the dead directly. Paper trail uploads ride the session Directus
 * token like resources; music-director approval needs both documents plus
 * at least one song. Scheduling, holding and cancelling move forward only.
 *
 * Run: node --test tests/web/funerals-family.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261029_0062_funerals.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261029_0062_funerals.down.sql'

describe('AFC-884 funeral register', () => {
  it('creates the register with person-or-name and a forward-only stage', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS funeral_cases/)
    assert.match(src, /deceased_person IS NOT NULL/)
    assert.match(
      src,
      /stage IN \('reported', 'approved', 'scheduled', 'held', 'cancelled'\)/,
    )
  })

  it('widens people.status with a named check and grants narrowly', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /people_status_lifecycle_check/)
    assert.match(src, /GRANT UPDATE \(status\) ON people TO directus_app/)
    assert.match(
      src,
      /GRANT UPDATE \([\s\S]*?\)\s*ON funeral_cases/,
      'update grant is column-scoped',
    )
    assert.match(src, /REVOKE ALL ON funeral_cases FROM PUBLIC/)
  })

  it('the rollback refuses with rows or deceased people, then narrows', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back funerals/)
    assert.match(src, /refusing to narrow people.status/)
    assert.match(src, /DROP TABLE IF EXISTS funeral_cases/)
    assert.match(src, /ADD CONSTRAINT people_status_check/)
  })
})

describe('AFC-884 funeral flow', () => {
  it('linking flips the person to deceased, never from the client', () => {
    const src = codeOf('apps/web/server/api/funerals/index.post.ts')
    assert.match(src, /status: 'deceased'/, 'route stamps deceased')
    assert.match(
      codeOf('apps/web/server/api/funerals/[id]/index.patch.ts'),
      /updateItem\(event, scope, 'people', personId, \{ status: 'deceased' \}\)/,
      'patch flips only the linked person, hardcoded value',
    )
  })

  it('approval needs both documents plus a song', () => {
    const src = codeOf('apps/web/server/api/funerals/[id]/approve.post.ts')
    assert.match(src, /documents_incomplete/, 'missing paper blocks approval')
    assert.match(src, /programme_empty/, 'songless programme blocks approval')
    assert.match(src, /programme_approved_by/, 'approver is stamped')
  })

  it('uploads ride the session token and demote approved programmes', () => {
    const src = codeOf('apps/web/server/api/funerals/[id]/documents.post.ts')
    assert.match(src, /readMultipartFormData/, 'multipart upload')
    assert.match(src, /death_certificate_file|consent_letter/, 'named slots only')
    assert.match(src, /programme_approved_by = null/, 're-upload voids approval')
  })

  it('stages move forward only and terminal cases are history', () => {
    const src = codeOf('apps/web/server/api/funerals/[id]/index.patch.ts')
    assert.match(src, /invalid_transition/, 'illegal moves refused')
    assert.match(src, /use_approve_route/, 'approval bypass refused')
    assert.match(src, /history and cannot change/, 'held/cancelled locked')
  })

  it('the register appears under Family with gated pages', () => {
    assert.match(
      codeOf('apps/web/utils/navigation.ts'),
      /to: '\/funerals'/,
      'nav entry under Family',
    )
    assert.match(
      codeOf('apps/web/utils/navigation.ts'),
      /funeral_cases.*read/,
      'nav gated on read',
    )
    assert.match(
      codeOf('apps/web/pages/funerals/index.vue'),
      /Open a funeral case/,
      'list opens cases',
    )
    assert.match(
      codeOf('apps/web/pages/funerals/[id].vue'),
      /Music director: approve programme/,
      'detail approves programmes',
    )
    assert.match(
      codeOf('apps/web/pages/funerals/[id].vue'),
      /role="tablist"/,
      'detail sub-menu is tabbed (AFC-899)',
    )
    assert.match(
      codeOf('apps/web/pages/funerals/[id].vue'),
      /v-if="tab === 'papers'"/,
      'paper trail is a tab',
    )
    assert.match(
      codeOf('apps/web/pages/funerals/[id].vue'),
      /v-if="tab === 'programme'"/,
      'programme is a tab',
    )
    assert.doesNotMatch(
      codeOf('apps/web/pages/funerals/[id].vue'),
      /contact|phone|email/,
      'no contact data on the page',
    )
  })
})
