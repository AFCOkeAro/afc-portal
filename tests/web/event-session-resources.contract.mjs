/**
 * AFC-883 contract — session-linked resources + checked-in handouts.
 *
 * A resource links to zero or one session of its own event (route-enforced;
 * cross-event links 400). Session handouts appear on the staff check-in tab
 * so checked-in participants receive them; approved session items also ride
 * the public library. Unset session means event-wide, as before.
 *
 * Run: node --test tests/web/event-session-resources.contract.mjs
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
  'services/directus/schema/migrations/20261029_0061_session_resources.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261029_0061_session_resources.down.sql'

describe('AFC-883 session link register', () => {
  it('adds an optional session link with a same-event FK that nulls on delete', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /ADD COLUMN IF NOT EXISTS session_id uuid/)
    assert.match(src, /REFERENCES attendance_sessions\(id\)/)
    assert.match(src, /ON DELETE SET NULL/)
  })

  it('grants only the link update (PUBLIC revocation is table-level, already in 0054)', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT UPDATE \(session_id\) ON event_resources TO directus_app/)
    assert.doesNotMatch(src, /GRANT (ALL|SELECT|INSERT|DELETE)/)
  })

  it('the rollback refuses while links are set and drops the column when clear', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back session links/)
    assert.match(src, /DROP COLUMN IF EXISTS session_id/)
  })
})

describe('AFC-883 session link enforcement', () => {
  it('create and patch accept a session and refuse cross-event links', () => {
    for (const rel of [
      'apps/web/server/api/events/[id]/resources.post.ts',
      'apps/web/server/api/events/resources/[id].patch.ts',
    ]) {
      const src = codeOf(rel)
      assert.match(src, /session_id/, `${rel} writes the link`)
      assert.match(
        src,
        /That session is not part of this event/,
        `${rel} refuses cross-event links`,
      )
    }
  })

  it('libraries expose the link and filter by it', () => {
    const src = codeOf('apps/web/server/api/events/[id]/resources.get.ts')
    assert.match(src, /session_id/, 'staff list carries the link')
    assert.match(src, /session_name/, 'staff list names the session')
    assert.match(src, /query\.session/, 'staff list filters by session')
  })

  it('the public library stays approved-only with the link attached', () => {
    const src = codeOf('apps/web/server/api/public/events/[id]/resources.get.ts')
    assert.match(src, /status: { _eq: 'approved' }/, 'approval gate unchanged')
    assert.match(src, /session_id/, 'public rows carry the session link')
    assert.match(src, /session_name/, 'public rows name the session')
  })

  it('checked-in participants get a session handout shelf', () => {
    const src = codeOf('apps/web/pages/events/[id].vue')
    assert.match(src, /handouts/, 'check-in tab loads session handouts')
    assert.match(src, /Session handouts/, 'handout shelf is labelled')
    assert.doesNotMatch(src, /session_without_event/, 'no dead-end without a session')
  })
})
