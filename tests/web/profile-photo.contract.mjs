/**
 * AFC-864 contract — profile + household photos (Kargul personal-details).
 *
 * Portrait slots ride the event_resources upload precedent: file id on the
 * row, bytes through a proxied route, never a bare Directus URL. The UI
 * shows the photo when set and initials when absent or broken.
 *
 * Run: node --test tests/web/profile-photo.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261029_0058_profile_photos.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261029_0058_profile_photos.down.sql'

describe('AFC-864 photo slots', () => {
  it('adds one photo slot per person and per household', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /ADD COLUMN IF NOT EXISTS photo_file uuid/)
    assert.match(src, /ALTER TABLE people ADD COLUMN/)
    assert.match(src, /ALTER TABLE households ADD COLUMN/)
  })

  it('grants only the slot update and takes no PUBLIC grant', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT UPDATE \(photo_file\) ON people TO directus_app/)
    assert.match(src, /GRANT UPDATE \(photo_file\) ON households TO directus_app/)
    assert.doesNotMatch(src, /GRANT .* TO PUBLIC/)
  })

  it('the rollback refuses while photos are set and drops the columns when clear', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back profile photos/)
    assert.match(src, /DROP COLUMN IF EXISTS photo_file/)
  })
})

describe('AFC-864 photo routes', () => {
  it('uploads set the slot with images-only and size guards', () => {
    for (const rel of [
      'apps/web/server/api/people/[id]/photo.post.ts',
      'apps/web/server/api/households/[id]/photo.post.ts',
    ]) {
      const src = codeOf(rel)
      assert.match(src, /readMultipartFormData/, `${rel} reads multipart`)
      assert.match(src, /image\/jpeg/, `${rel} allows JPEG`)
      assert.match(src, /image\/png/, `${rel} allows PNG`)
      assert.match(src, /image\/webp/, `${rel} allows WebP`)
      assert.match(src, /MAX_BYTES/, `${rel} caps the size`)
      assert.match(src, /\/files/, `${rel} stores in Directus files`)
      assert.match(src, /photo_file: fileId/, `${rel} writes the slot`)
      assert.match(src, /method: 'DELETE'/, `${rel} cleans the replaced file`)
    }
  })

  it('photo reads are scoped, proxied, and never bare Directus URLs', () => {
    for (const rel of [
      'apps/web/server/api/people/[id]/photo.get.ts',
      'apps/web/server/api/households/[id]/photo.get.ts',
    ]) {
      const src = codeOf(rel)
      assert.match(src, /requireCan/, `${rel} gates the read`)
      assert.match(src, /findScopedItem/, `${rel} scopes the row`)
      assert.match(src, /\/assets\//, `${rel} proxies stored bytes`)
      assert.match(src, /new Response\(upstream\.body/, `${rel} streams bytes`)
      assert.doesNotMatch(src, /redirect/, `${rel} never redirects`)
    }
  })

  it('no-photo rows 404 so the UI falls back to initials', () => {
    for (const rel of [
      'apps/web/server/api/people/[id]/photo.get.ts',
      'apps/web/server/api/households/[id]/photo.get.ts',
    ]) {
      assert.match(codeOf(rel), /no_photo/, `${rel} names the empty slot`)
    }
  })
})

describe('AFC-864 photo UI', () => {
  it('the avatar shows the photo or initials, never a broken image', () => {
    const src = codeOf('apps/web/components/ProfileAvatar.vue')
    assert.match(src, /@error="failed = true"/, 'a broken photo falls back')
    assert.match(src, /initials/, 'initials render without a photo')
    assert.match(src, /photoUrl/, 'the photo URL is a prop')
  })

  it('the profile header carries the photo with an upload control', () => {
    const src = codeOf('apps/web/pages/people/[id].vue')
    assert.match(src, /<ProfileAvatar/, 'the header renders the avatar')
    assert.match(src, /uploadPhoto/, 'the header offers an upload')
    assert.match(src, /people.*update/, 'the upload sits behind the update grant')
  })

  it('the household header carries the photo and members show initials', () => {
    const src = codeOf('apps/web/pages/households/[id].vue')
    assert.match(src, /<ProfileAvatar/, 'the header renders the avatar')
    assert.match(src, /uploadPhoto/, 'the header offers an upload')
    assert.match(src, /size="sm"/, 'member rows show small avatars')
  })
})
