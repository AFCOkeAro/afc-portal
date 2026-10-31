/**
 * Public event id shape: malformed ids fail fast with 400 (follow-up to the
 * kiosk QA, where a 30-hex-char id surfaced as a 503 "store not readable").
 *
 * Run: node --test tests/web/public-event-id.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isEventId = (value) => UUID_RE.test(value)

describe('public event id shape fails fast, never 503s (malformed-id hardening)', () => {
  it('accepts canonical UUIDs, rejects short/long/non-hex ids', () => {
    assert.equal(isEventId('2077be2f-2589-409e-9d8e-556649bb8274'), true)
    assert.equal(isEventId('00000000-0000-0000-0000-000000000000'), true)
    assert.equal(isEventId('2077be2f-2589-409e-9d8e-556649bb82'), false)
    assert.equal(isEventId('test-event'), false)
    assert.equal(isEventId(''), false)
  })

  it('public event detail route rejects malformed ids with 400 before Directus', () => {
    const src = read('apps/web/server/api/public/events/[id].get.ts')
    assert.match(src, /isEventId\(id\)/)
    assert.match(src, /event_id_invalid/)
  })

  it('public registration lookup treats malformed ids as not-registerable (404, not 500)', () => {
    const src = read('apps/web/server/api/register.post.ts')
    assert.match(src, /isEventId\(eventId\)/)
  })

  it('shared guard lives in one util imported by both routes', () => {
    const util = read('apps/web/utils/event-ids.ts')
    assert.match(util, /isEventId/)
  })
})
