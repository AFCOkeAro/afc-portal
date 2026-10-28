/**
 * AFC-826 contract — event schedules with sessions and activity breakdown.
 *
 * One model: schedule sessions ARE attendance_sessions (no new header
 * tables). The builder lists an event's sessions, creates new ones, and
 * manages per-session programme items (session_activities). Scope is
 * route-stamped from the parent session (0044 choice-8, no scope trigger).
 *
 * Run: node --test tests/web/schedule-builder.contract.mjs
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
  'services/directus/schema/migrations/20261028_0050_session_activities.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0050_session_activities.down.sql'
const UI = 'apps/web/components/ScheduleBuilder.vue'
const LIST = 'apps/web/server/api/attendance/index.get.ts'

describe('AFC-826 session activities register', () => {
  it('creates the programme-items table with a closed activity set', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS session_activities/)
    assert.match(src, /bible_reading/, 'activity set names its members')
    assert.match(src, /session_activities_session_fkey/, 'named FK for suite parking')
  })

  it('grants the builder verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON session_activities TO directus_app/)
    assert.match(src, /GRANT INSERT \(session, branch, zone/)
    assert.match(src, /GRANT DELETE ON session_activities TO directus_app/)
    assert.match(src, /REVOKE ALL ON session_activities FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back session_activities/)
    assert.match(src, /DROP TABLE IF EXISTS session_activities/)
  })
})

describe('AFC-826 schedule API', () => {
  it('the session list filters by event', () => {
    const src = codeOf(LIST)
    assert.match(src, /eventId/, 'event query param read')
    assert.match(src, /event: \{ _eq: eventId \}/, 'event scoped at the query')
  })

  it('activity routes scope through the parent session', () => {
    for (const rel of [
      'apps/web/server/api/attendance/sessions/[id]/activities/index.get.ts',
      'apps/web/server/api/attendance/sessions/[id]/activities/index.post.ts',
      'apps/web/server/api/attendance/activities/[id].patch.ts',
      'apps/web/server/api/attendance/activities/[id].delete.ts',
    ]) {
      const src = codeOf(rel)
      assert.match(src, /findScopedItem/, `${rel} scope-gates`)
      assert.match(src, /session_activities/, `${rel} hits the 0050 register`)
    }
  })

  it('creates stamp branch and zone from the parent session', () => {
    const src = codeOf(
      'apps/web/server/api/attendance/sessions/[id]/activities/index.post.ts',
    )
    assert.match(src, /branch: session\.branch/, 'branch stamped from parent')
    assert.match(src, /zone: session\.zone/, 'zone stamped from parent')
  })
})

describe('AFC-826 schedule UI', () => {
  it('the Schedule tab renders the builder', () => {
    const src = codeOf('apps/web/pages/events/[id].vue')
    assert.match(src, /ScheduleBuilder/, 'tab renders the builder')
    assert.match(src, /sessions ARE attendance_sessions/, 'one-model note kept')
  })

  it('the builder lists sessions, manages items, and reorders', () => {
    const src = codeOf(UI)
    assert.match(src, /loadSessions/, 'sessions load per event')
    assert.match(src, /addItem/, 'items append')
    assert.match(src, /removeItem/, 'items remove')
    assert.match(src, /moveItem/, 'items reorder')
    assert.match(src, /SESSION_ACTIVITY_TYPES/, 'type set drawn from shared')
  })
})
