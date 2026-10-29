/**
 * AFC-901 contract — face circles on the people and household lists.
 *
 * ProfileAvatar (photo or initials, fail-closed) renders at small size in
 * each list row; the photo URL only exists when the row carries a photo
 * slot, and the list payloads expose that slot.
 *
 * Run: node --test tests/web/list-avatars.contract.mjs
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

describe('AFC-901 list avatars', () => {
  it('the people list exposes the photo slot and renders avatars', () => {
    assert.match(
      codeOf('apps/web/server/api/people/index.get.ts'),
      /'photo_file'/,
      'people list carries photo_file',
    )
    const src = codeOf('apps/web/pages/people/index.vue')
    assert.match(src, /<ProfileAvatar/, 'people rows render avatars')
    assert.match(
      src,
      /photo_file[\s\S]{0,40}`\/api\/people\//,
      'photo URL only when the slot is set',
    )
    assert.match(src, /size="sm"/, 'avatars are small in the list')
  })

  it('the households list exposes the photo slot and renders avatars', () => {
    assert.match(
      codeOf('apps/web/server/api/households/index.get.ts'),
      /'photo_file'/,
      'households list carries photo_file',
    )
    const src = codeOf('apps/web/pages/households/index.vue')
    assert.match(src, /<ProfileAvatar/, 'household rows render avatars')
    assert.match(
      src,
      /photo_file[\s\S]{0,40}`\/api\/households\//,
      'photo URL only when the slot is set',
    )
  })

  it('a missing or broken photo falls back to initials, never a broken image', () => {
    const src = codeOf('apps/web/components/ProfileAvatar.vue')
    assert.match(src, /@error="failed = true"/, 'broken photos fall back')
    assert.match(src, /initials/, 'initials render without a photo')
  })
})
