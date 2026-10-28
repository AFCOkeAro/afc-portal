/**
 * AFC-833 contract — task board drag-and-drop, owner names, RACI ring.
 *
 * Board cards move via drag-and-drop onto status columns (PATCH status);
 * cards name the owner (assignee person, Directus user fallback); the
 * task detail page edits the four-seat RACI ring through a dedicated
 * endpoint (null clears a seat), audited as raci_changed.
 *
 * Run: node --test tests/web/task-board.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261028_0047_task_raci.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0047_task_raci.down.sql'
const BOARD = 'apps/web/components/TaskViews.vue'
const DETAIL = 'apps/web/pages/tasks/[id].vue'
const RACI = 'apps/web/server/api/tasks/[id]/raci.patch.ts'

describe('AFC-833 RACI register', () => {
  it('adds four nullable person refs with conditional FKs', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /raci_responsible|raci_accountable|raci_consulted|raci_informed/)
    assert.match(src, /to_regclass\('public\.people'\)/)
    assert.match(src, /ON DELETE SET NULL/)
  })

  it('grants UPDATE on the ring and revokes PUBLIC', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /GRANT UPDATE \(raci_responsible/)
    assert.match(src, /REVOKE ALL ON tasks FROM PUBLIC/)
  })

  it('rolls back only when no member is named', () => {
    const src = codeOf(DOWN)
    assert.match(src, /raci_responsible IS NOT NULL/)
    assert.match(src, /DROP COLUMN IF EXISTS/)
  })
})

describe('AFC-833 board drag-and-drop + owner names', () => {
  it('cards are draggable and columns accept drops onto statuses', () => {
    const src = codeOf(BOARD)
    assert.match(src, /:draggable="canMove"/, 'drag gated on the update grant')
    assert.match(
      src,
      /@drop\.prevent="onDrop\(column\.id\)"/,
      'drop targets the column status',
    )
    assert.match(src, /api\.patch\(`\/api\/tasks\/\$\{id\}`/, 'drop PATCHes the status')
  })

  it('cards name the owner and show RACI initials', () => {
    const src = codeOf(BOARD)
    assert.match(src, /Owner: /, 'owner line on every card')
    assert.match(src, /raciOf\(row\)/, 'R/A/C/I badges from resolved names')
  })

  it('the list route enriches rows without failing closed', () => {
    const src = codeOf('apps/web/server/api/tasks/index.get.ts')
    assert.match(src, /resolveTaskPeople/, 'owner + RACI names resolved server-side')
    assert.match(src, /owner_name/, 'rows carry the display name')
  })
})

describe('AFC-833 RACI editing', () => {
  it('the endpoint validates seats and audits distinctly', () => {
    const src = codeOf(RACI)
    assert.match(
      src,
      /raci_responsible.*raci_accountable.*raci_consulted.*raci_informed/s,
    )
    assert.match(src, /raci_changed/, 'distinct audit event')
    assert.match(src, /requireCan\(scope, 'tasks', 'update'\)/, 'update grant required')
  })

  it('the detail page offers four person seats with clear', () => {
    const src = codeOf(DETAIL)
    assert.match(src, /RACI_SEATS/, 'four labelled seats')
    assert.match(src, /saveRaci/, 'dedicated save path')
    assert.match(
      src,
      /\/api\/tasks\/\$\{id\}\/raci/,
      'hits the raci endpoint, not the status one',
    )
  })
})
