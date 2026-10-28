/**
 * AFC-828 phase 3 contract — landing-page resources (approved only).
 *
 * The public landing lists approved materials (links open, files download
 * through the event-scoped proxy). Drafts and rejections never reach the
 * feed; the file proxy re-checks approval + visibility server-side.
 *
 * Run: node --test tests/web/public-event-resources.contract.mjs
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

describe('AFC-828 phase 3 public resources', () => {
  it('the list route gates on visibility and approval server-side', () => {
    const src = codeOf('apps/web/server/api/public/events/[id]/resources.get.ts')
    assert.match(src, /directusPublicToken/)
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    assert.match(src, /status: \{ _eq: 'published' \}/)
    assert.match(src, /status: \{ _eq: 'approved' \}/)
    assert.doesNotMatch(
      src,
      /getPortalScope|requireSession/,
      'no session on the public path',
    )
  })

  it('the file proxy re-checks approval and visibility, never bare URLs', () => {
    const src = codeOf('apps/web/server/api/public/events/[id]/resources/file.get.ts')
    assert.match(src, /status: \{ _eq: 'approved' \}/)
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    assert.doesNotMatch(
      src,
      /contact|email|phone|guardian/,
      'no personal columns touched',
    )
  })

  it('the landing page lists approved resources with open/download', () => {
    const src = codeOf('apps/web/pages/p/[id].vue')
    assert.match(src, /resources\/file\?file=/)
    assert.match(src, /aria-label="Event resources"/)
  })
})
