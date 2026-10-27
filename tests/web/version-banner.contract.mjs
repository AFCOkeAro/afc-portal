/**
 * AFC-821 contract — the update banner.
 *
 * Pins the "just works" half of the staging loop: the client plugin polls
 * `/api/health`, compares the served SHA to the baked `public.buildSha`,
 * and flips the shared `afc:update-available` flag; the default layout
 * renders a refresh banner from it. The health endpoint is the SHA-proof
 * side (its `sha` field is asserted here so a rename breaks loudly).
 *
 * Run: node --test tests/web/version-banner.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const PLUGIN = 'apps/web/plugins/version-check.client.ts'
const LAYOUT = 'apps/web/layouts/default.vue'
const HEALTH = 'apps/web/server/api/health.get.ts'

describe('AFC-821 update banner', () => {
  it('the plugin polls the health endpoint and compares SHAs', () => {
    const src = read(PLUGIN)
    assert.match(src, /\/api\/health/, 'polls the health endpoint')
    assert.match(src, /public\.buildSha/, 'reads the baked build SHA')
    assert.match(src, /afc:update-available/, 'flips the shared update-available flag')
  })

  it('the health endpoint exposes the build SHA', () => {
    const src = read(HEALTH)
    assert.match(src, /\bsha\s*:/, 'health payload carries a sha field')
  })

  it('the staff layout renders a refresh banner from the flag', () => {
    const src = read(LAYOUT)
    assert.match(src, /afc:update-available/, 'layout reads the update-available flag')
    assert.match(src, /location\.reload/, 'banner refreshes the page')
  })
})
