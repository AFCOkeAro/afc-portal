/**
 * AFC-828 phase 4 contract — registration QR + public testimonies.
 *
 * The registration code renders as a scannable QR (client-side encoding,
 * SVG rects, no file round-trip; the text code stays the source of
 * truth). Testimonies submit through the public proxy and list on the
 * staff Testimonies tab. Phase 4 completes the landing page.
 *
 * Run: node --test tests/web/public-event-phase4.contract.mjs
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
  'services/directus/schema/migrations/20261028_0057_event_testimonies.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0057_event_testimonies.down.sql'

describe('AFC-828 phase 4 testimony register', () => {
  it('creates the submissions table with a required message', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_testimonies/)
    assert.match(src, /message/)
  })

  it('grants the submission verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON event_testimonies TO directus_app/)
    assert.match(src, /GRANT INSERT \(event, branch, zone, name, message, contact\)/)
    assert.match(src, /GRANT DELETE ON event_testimonies TO directus_app/)
    assert.match(src, /REVOKE ALL ON event_testimonies FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back event testimonies/)
    assert.match(src, /DROP TABLE IF EXISTS event_testimonies/)
  })
})

describe('AFC-828 phase 4 surface', () => {
  it('the registration QR encodes client-side with a quiet zone', () => {
    const src = codeOf('apps/web/components/TicketQr.vue')
    assert.match(src, /encodeQR/)
    assert.match(src, /-2 -2/)
    assert.match(src, /role="img"/)
  })

  it('the register page shows the QR with its ticket code', () => {
    const src = codeOf('apps/web/pages/register.vue')
    assert.match(src, /<TicketQr/)
    assert.match(src, /ticket_code/)
  })

  it('testimonies submit publicly and list for staff', () => {
    const src = codeOf('apps/web/server/api/public/events/[id]/testimonies.post.ts')
    assert.match(src, /directusPublicToken/)
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    const page = codeOf('apps/web/pages/p/[id].vue')
    assert.match(page, /submitTestimony/)
    assert.match(page, /Thank you/)
    const staff = codeOf('apps/web/pages/events/[id].vue')
    assert.match(staff, /<TestimonyList :event-id="id" \/>/)
  })
})
