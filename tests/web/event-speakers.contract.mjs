/**
 * AFC-843 contract — speakers management tab (booked/pending, requests).
 *
 * Bookings name a directory person or a typed external name (never both);
 * status tracks invited/pending/booked/confirmed/declined. The Speakers tab
 * hides without the read grant; scope is enforced server-side.
 *
 * Run: node --test tests/web/event-speakers.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261028_0053_event_speakers.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0053_event_speakers.down.sql'
const PAGE = 'apps/web/pages/events/[id].vue'
const MANAGER = 'apps/web/components/SpeakerManager.vue'

describe('AFC-843 speaker register', () => {
  it('creates the bookings table with person-or-name and closed status', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_speakers/)
    assert.match(src, /event_speakers_person_or_name/)
    assert.match(src, /confirmed/)
    assert.match(src, /declined/)
  })

  it('grants the booking verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON event_speakers TO directus_app/)
    assert.match(src, /GRANT INSERT \(event, branch, zone, person/)
    assert.match(src, /GRANT DELETE ON event_speakers TO directus_app/)
    assert.match(src, /REVOKE ALL ON event_speakers FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back event speakers/)
    assert.match(src, /DROP TABLE IF EXISTS event_speakers/)
  })
})

describe('AFC-843 speakers tab', () => {
  it('the tab hides without the grant and gates management', () => {
    const src = codeOf(PAGE)
    assert.match(src, /canSpeakers/)
    assert.match(src, /canManageSpeakers/)
    assert.match(src, /id: 'speakers', label: 'Speakers'/)
  })

  it('the manager shows booked vs pending and moves status', () => {
    const src = codeOf(MANAGER)
    assert.match(src, /bookedCount/)
    assert.match(src, /pendingCount/)
    assert.match(src, /moveStatus/)
    assert.match(src, /special_requests/)
  })

  it('booking routes scope-gate through the parent event', () => {
    for (const rel of [
      'apps/web/server/api/events/[id]/speakers.get.ts',
      'apps/web/server/api/events/[id]/speakers.post.ts',
      'apps/web/server/api/events/speakers/[id].patch.ts',
      'apps/web/server/api/events/speakers/[id].delete.ts',
    ]) {
      const src = codeOf(rel)
      assert.match(src, /findScopedItem/, `${rel} scope-gates`)
    }
  })
})
