/**
 * AFC-880 contract — event collaborators with per-area grants.
 *
 * Delegation never widens the role matrix: a scoped write passes on the
 * role grant OR on a collaborator row whose areas include the write's
 * area. Reads are unchanged. A schedule-only collaborator cannot touch
 * the budget; an unknown body key on PATCH is details.
 *
 * Run: node --test tests/web/event-collaborators.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261029_0060_event_collaborators.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261029_0060_event_collaborators.down.sql'
const HELPER = 'apps/web/server/utils/event-access.ts'

describe('AFC-880 collaborator register', () => {
  it('creates one row per event-person pair with a confined area set', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_collaborators/)
    assert.match(src, /event_collaborators_once/)
    assert.match(src, /details.*schedule.*speakers.*resources.*budget.*registration/s)
  })

  it('grants UPDATE on the areas column and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT UPDATE \(areas\)/)
    assert.match(src, /REVOKE ALL ON event_collaborators FROM PUBLIC/)
  })

  it('the rollback refuses while delegations exist and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back event collaborators/)
    assert.match(src, /DROP TABLE IF EXISTS event_collaborators/)
  })
})

describe('AFC-880 area enforcement', () => {
  it('unknown PATCH keys are details, never a free pass', () => {
    const src = codeOf(HELPER)
    assert.match(src, /areasForEventPatch/, 'PATCH keys map to areas')
    assert.match(src, /details/, 'unknown keys fall back to details')
  })

  it('a collaborator check fails closed without a session user', () => {
    const src = codeOf(HELPER)
    assert.match(src, /collaboratorAreas/, 'scoped collaborator lookup exists')
    assert.match(src, /return \[\]/, 'unreadable means no areas')
  })

  it('every write area has a route gate', () => {
    const gates = [
      ['apps/web/server/api/events/[id].patch.ts', /areasForEventPatch/],
      ['apps/web/server/api/events/[id]/speakers.post.ts', /'speakers'/],
      ['apps/web/server/api/events/[id]/resources.post.ts', /'resources'/],
      ['apps/web/server/api/events/[id]/expenses.post.ts', /'budget'/],
      ['apps/web/server/api/events/[id]/budgets/index.post.ts', /'budget'/],
      ['apps/web/server/api/events/[id]/registrations.post.ts', /'registration'/],
      ['apps/web/server/api/events/[id]/check-in.post.ts', /'registration'/],
      [
        'apps/web/server/api/attendance/sessions/[id]/activities/index.post.ts',
        /'schedule'/,
      ],
    ]
    for (const [rel, pattern] of gates) {
      assert.match(codeOf(rel), pattern, `${rel} enforces its area`)
    }
  })

  it('the manage routes stay on events update', () => {
    for (const rel of [
      'apps/web/server/api/events/[id]/collaborators/index.get.ts',
      'apps/web/server/api/events/[id]/collaborators/index.post.ts',
      'apps/web/server/api/events/[id]/collaborators/[collaboratorId]/index.delete.ts',
    ]) {
      assert.match(
        codeOf(rel),
        /requireCan\(scope, 'event/,
        `${rel} reads through the register`,
      )
    }
    assert.match(
      codeOf('apps/web/server/api/events/[id]/collaborators/index.post.ts'),
      /requireCan\(scope, 'events', 'update'\)/,
      'adding needs full programme edit',
    )
  })
})

describe('AFC-880 collaborator UI', () => {
  it('the event page mounts the manager with per-area ticks', () => {
    const src = codeOf('apps/web/pages/events/[id].vue')
    assert.match(src, /<CollaboratorsCard/, 'manager card is mounted')
    assert.match(src, /:can-manage="canEdit"/, 'assignment stays on full edit')
  })

  it('the card lists areas and adds/removes without widening reads', () => {
    const src = codeOf('apps/web/components/CollaboratorsCard.vue')
    assert.match(src, /toggleArea/, 'areas are ticked per person')
    assert.match(src, /removeCollaborator/, 'delegations withdraw from the card')
    assert.doesNotMatch(src, /phone|email|contact/, 'no contact data in the card')
  })
})
