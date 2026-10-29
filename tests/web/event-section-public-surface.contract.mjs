/**
 * AFC-871 slice 2 contract — public surface failure shapes.
 *
 * Gates: the public detail endpoint serves a section only at exactly
 * `public`; `draft`/`private`/`login`/`custom` fail closed (omitted, never
 * served). `custom` has no audience model — recorded debt, must never pass
 * as public or login. Registration writes require the registration section
 * at `public`. Shapes: 503 without the public token, 404 (not 403) for
 * anything an anonymous caller may not see.
 *
 * Run: node --test tests/web/event-section-public-surface.contract.mjs
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

describe('AFC-871 slice 2 public detail predicate', () => {
  it('is session-free behind the public token with a 503 closed shape', () => {
    const src = codeOf('apps/web/server/api/public/events/[id].get.ts')
    assert.match(src, /directusPublicToken/)
    assert.match(src, /event_public_unavailable/)
    assert.match(src, /statusCode: 503/)
    assert.doesNotMatch(src, /getPortalScope|requireSession/)
    assert.doesNotMatch(src, /server token/i)
  })

  it('reads only public + published rows, never an existence oracle', () => {
    const src = codeOf('apps/web/server/api/public/events/[id].get.ts')
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    assert.match(src, /status: \{ _eq: 'published' \}/)
    assert.match(src, /event_not_public/)
    assert.match(src, /statusCode: 404/)
    assert.doesNotMatch(src, /statusCode: 403/)
  })

  it('serves a section only at exactly public; login and custom fail closed', () => {
    const src = codeOf('apps/web/server/api/public/events/[id].get.ts')
    assert.match(src, /=== 'public'/)
    assert.match(src, /registration_open/)
    assert.match(src, /speakers:.*\? .* : null/s)
    assert.match(src, /resources:.*\? .* : null/s)
    assert.match(src, /schedule:.*\? .* : null/s)
    // Custom is never served as public or login: no audience model.
    assert.doesNotMatch(src, /custom.*login|login.*custom/i)
    assert.match(read('apps/web/server/api/public/events/[id].get.ts'), /fail closed/i)
  })
})

describe('AFC-871 slice 2 registration gate', () => {
  it('requires the registration section at public, failing closed with 404', () => {
    const src = codeOf('apps/web/server/api/register.post.ts')
    assert.match(src, /registration_visibility/)
    assert.match(src, /event_not_registerable/)
    assert.match(src, /statusCode: 404/)
    assert.doesNotMatch(
      src,
      /registration_visibility.*_eq.*login|login.*registration_visibility/,
    )
  })

  it('the register stepper keeps seven steps with whole-form validation', () => {
    const src = codeOf('apps/web/pages/register.vue')
    for (const label of [
      'Event',
      'Name',
      'Contact',
      'Age',
      'Guardian',
      'Health',
      'Review',
    ]) {
      assert.ok(src.includes(label), `stepper shows ${label}`)
    }
    assert.match(src, /registrationFormSchema/)
    assert.match(src, /goStep/)
  })
})

describe('AFC-871 slice 2 staff editors', () => {
  it('the shared schema carries optional section arrays that cannot be wiped by omission', () => {
    const src = codeOf('packages/shared/src/schemas/event.ts')
    assert.match(src, /SECTION_VISIBILITIES/)
    assert.match(src, /speakers.*optional|optional.*speakers/s)
    assert.match(src, /form\.speakers !== undefined/)
  })

  it('staff detail reads the new columns and mounts the section editors', () => {
    const src = codeOf('apps/web/server/api/events/[id].get.ts')
    assert.match(src, /registration_visibility/)
    assert.match(src, /speakers_visibility/)
    assert.match(src, /schedule_visibility/)
    assert.match(src, /speakers/)
    const page = codeOf('apps/web/pages/events/[id].vue')
    assert.match(page, /EventSectionEditors/)
    const editor = codeOf('apps/web/components/EventSectionEditors.vue')
    assert.match(editor, /must be a JSON array/)
    assert.match(editor, /login and custom/i)
  })

  it('the signed-out programme page names the fail-closed state per section', () => {
    const src = codeOf('apps/web/pages/programmes/[id].vue')
    assert.match(src, /\/api\/public\/events\//)
    assert.match(src, /not shared publicly/)
    assert.match(src, /Registration is not open publicly/)
  })
})
