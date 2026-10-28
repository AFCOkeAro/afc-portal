/**
 * AFC-828 phase 1 contract — public event landing page.
 *
 * One public page per event (details + register CTA). Session-free feed,
 * public token only, server-side visibility=public AND status=published
 * predicate, allowlisted fields, stripped response. Later phases (resources,
 * feedback, QR, blessings) are recorded on the issue, not built here.
 *
 * Run: node --test tests/web/public-event-landing.contract.mjs
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

const ROUTE = 'apps/web/server/api/public/events/[id].get.ts'
const PAGE = 'apps/web/pages/p/[id].vue'

describe('AFC-828 phase 1 public event page', () => {
  it('the route never touches a session and needs the public token', () => {
    const src = codeOf(ROUTE)
    assert.doesNotMatch(src, /getPortalScope|requireSession/)
    assert.match(src, /directusPublicToken/)
    assert.match(src, /event_public_unavailable/)
  })

  it('the visibility predicate is server-side and fail-closed', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    assert.match(src, /status: \{ _eq: 'published' \}/)
    assert.match(src, /404/, 'non-public events 404 like missing ones')
  })

  it('the fields are allowlisted and the response is stripped', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /PUBLIC_EVENT_FIELDS/)
    assert.doesNotMatch(src, /ticket_code|amount_paid|guardian|medical|phone|email/)
  })

  it('the page renders details with a register call-to-action', () => {
    const src = codeOf(PAGE)
    assert.match(src, /layout: 'public'/)
    assert.match(src, /\/register\?event=/)
    assert.match(src, /branch_name/)
  })
})
