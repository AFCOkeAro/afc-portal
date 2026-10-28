/**
 * AFC-844 contract — resources library with approval (link/upload, kinds).
 *
 * Items are links or uploads (documents, spreadsheets, PDFs, images,
 * video, archives); only approved rows render on the Resources page.
 * Uploads ride the receipt precedent; downloads proxy through the event
 * route, never a bare Directus URL.
 *
 * Run: node --test tests/web/event-resources.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261028_0054_event_resources.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0054_event_resources.down.sql'
const LIBRARY = 'apps/web/components/ResourceLibrary.vue'

describe('AFC-844 resources register', () => {
  it('creates the library table with link-or-upload pairing', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_resources/)
    assert.match(src, /event_resources_link_or_upload/)
    assert.match(src, /spreadsheet/)
    assert.match(src, /archive/)
  })

  it('the speaker link is conditional on the AFC-843 slice', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /event_resources_speaker_fkey/)
    assert.match(src, /to_regclass\('public\.event_speakers'\)/)
  })

  it('grants the library verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON event_resources TO directus_app/)
    assert.match(src, /GRANT INSERT \(event, speaker, branch, zone, title/)
    assert.match(src, /GRANT DELETE ON event_resources TO directus_app/)
    assert.match(src, /REVOKE ALL ON event_resources FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back event resources/)
    assert.match(src, /DROP TABLE IF EXISTS event_resources/)
  })
})

describe('AFC-844 library UI and routes', () => {
  it('unapproved rows never render as the library', () => {
    const src = codeOf('apps/web/server/api/events/[id]/resources.get.ts')
    assert.match(
      src,
      /status: \{ _eq: 'approved' \}/,
      'default response is approved only',
    )
    assert.match(
      src,
      /requireCan\(scope, 'event_resources', 'update'\)/,
      'queue needs the manage grant',
    )
  })

  it('the library approves, rejects and proxies downloads', () => {
    const src = codeOf(LIBRARY)
    assert.match(src, /Awaiting approval/)
    assert.match(src, /resources\/file\?file=/)
    assert.match(src, /resources\/upload/)
  })

  it('uploads cap size and type, then hand the file id to the create', () => {
    const src = codeOf('apps/web/server/api/events/[id]/resources/upload.post.ts')
    assert.match(src, /MAX_BYTES/)
    assert.match(src, /ALLOWED_TYPES/)
    assert.match(src, /directus_files|directusBaseUrl/)
  })
})
