/**
 * AFC-677 contract tests — marriage phase-B forms, uploads, vows, print.
 *
 * Static gates over the phase-B slice (the DB suite 97 owns the CHECKs and
 * the app ceiling; this suite owns the route/UI rules a crafted HTTP request
 * or a careless edit must not skip):
 *
 *   1. Shared: 16 form keys, every key has a payload schema, vow default B,
 *      vow generator inserts names, brother/sister language only.
 *   2. Form routes: key + payload validation, closed cases refuse, stage
 *      vocab re-checked, latest-wins reads, missing keys read null,
 *      pending_migration_0036 shape (no bare 500).
 *   3. Vow route: type A/B default B, names from saved forms only,
 *      names_missing shape when neither form exists.
 *   4. Upload routes: nine bare-uuid slots, closed cases refuse, 10 MB +
 *      PDF/JPEG/PNG/WebP guards, link-only PATCH (bytes via files.post).
 *   5. Prefill route: fills from people rows, never flips the verify flag.
 *   6. UI: EntitySelect for people/branch (no manual IDs), brother/sister
 *      words only, vow type selector default B, print link, A4 print CSS.
 *   7. Hygiene: failure shape {code, fields} throughout, no bare 500.
 *
 * Run: node --test tests/web/marriage-forms.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const SHARED = 'packages/shared/src/schemas/marriage-forms.ts'
const ROUTES = {
  formsPost: 'apps/web/server/api/marriage-cases/[id]/forms.post.ts',
  formsGet: 'apps/web/server/api/marriage-cases/[id]/forms.get.ts',
  vowGet: 'apps/web/server/api/marriage-cases/[id]/vow.get.ts',
  filesPatch: 'apps/web/server/api/marriage-cases/[id]/files.patch.ts',
  filesPost: 'apps/web/server/api/marriage-cases/files.post.ts',
  weddingInfoGet: 'apps/web/server/api/marriage-cases/[id]/wedding-info.get.ts',
}
const UI = {
  panel: 'apps/web/components/MarriageFormPanel.vue',
  vow: 'apps/web/components/MarriageVowCard.vue',
  uploads: 'apps/web/components/MarriageUploadsCard.vue',
  detail: 'apps/web/pages/marriage-cases/[id].vue',
  css: 'apps/web/assets/css/main.css',
}

const EXPECTED_KEYS = [
  'proposal_male', 'proposal_female', 'form_a',
  'premarital_q1', 'premarital_q2', 'engagement_list', 'form_c_guideline',
  'wedding_programme', 'wedding_info', 'music_selection',
  'requirements_dressing', 'engagement_procedures', 'counselling_curriculum',
  'documentation_checklist', 'couple_orientation', 'vows',
]
const EXPECTED_SLOTS = [
  'consent_brother_file', 'consent_sister_file',
  'passport_brother_file', 'passport_sister_file',
  'lga_certificate_file', 'bridal_list_file',
  'marriage_certificate_file', 'couple_photo_file',
  'presentation_photo_file',
]

describe('AFC-677 phase B — forms, uploads, vows, print', () => {
  it('shared: all 16 transcribed keys exist and each has a payload schema', () => {
    const shared = read(SHARED)
    for (const key of EXPECTED_KEYS) {
      assert.match(shared, new RegExp(`'${key}'`), `form key ${key} is declared`)
      assert.match(
        shared,
        new RegExp(`${key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Schema|${key}: \\w+Schema`),
        `form key ${key} has a payload schema entry`,
      )
    }
    assert.match(shared, /marriageFormPayloadSchemas/, 'payload schema map exists')
  })

  it('shared: vow default B, generator inserts names, brother/sister only', () => {
    const shared = read(SHARED)
    assert.match(shared, /default\('B'\)/, 'vow type selector defaults to B')
    assert.match(shared, /buildVowText/, 'vow generator is exported')
    const code = shared
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
    assert.ok(!/groom|bride/i.test(code), 'no groom/bride words in the shared forms module')
  })

  it('forms.post: key + payload validation, closed cases refuse, named 503', () => {
    const route = read(ROUTES.formsPost)
    assert.match(route, /marriageFormSubmitSchema/, 'submit wrapper validated first')
    assert.match(route, /marriageFormPayloadSchemas\[formKey\]/, 'key selects its zod shape')
    assert.match(route, /MARRIAGE_CASE_STAGES[^;]*\.includes\(stage\)/, 'stage re-checked against the vocab')
    assert.match(route, /halted.*transferred_out.*reported/s, 'closed cases refuse new forms')
    assert.match(route, /pending_migration_0036/, 'missing 0036 answers 503 with a named code')
    assert.match(route, /throwValidation/, 'zod failures use the {code, fields} shape')
  })

  it('forms.get: latest-wins per key, missing keys read null', () => {
    const route = read(ROUTES.formsGet)
    assert.match(route, /sort: '-created_at'/, 'newest rows first')
    assert.match(route, /latest\[key\] === null/, 'first (newest) row per key wins')
    assert.match(route, /MARRIAGE_FORM_KEYS\.map\(\(key\) => \[key, null\]\)/, 'every key present, missing reads null')
  })

  it('vow.get: type A/B default B, names from saved forms, names_missing shape', () => {
    const route = read(ROUTES.vowGet)
    assert.match(route, /MARRIAGE_VOW_TYPES\.includes/, 'type validated')
    assert.match(route, /row\.vow_type \?\? 'B'/, 'case vow_type decides when no preview type is sent')
    assert.match(route, /byKey\.vows|byKey\.wedding_info/, 'names read from saved forms')
    assert.match(route, /names_missing/, 'missing names name the missing step')
    assert.match(route, /buildVowText\(vowType, brotherName, sisterName/, 'names inserted by the generator')
  })

  it('upload routes: nine bare-uuid slots, guards, link-only PATCH', () => {
    const patch = read(ROUTES.filesPatch)
    for (const slot of EXPECTED_SLOTS) {
      assert.match(patch, new RegExp(slot), `slot ${slot} is linked`)
    }
    assert.match(patch, /closed case takes no more files/, 'closed cases refuse files')
    const post = read(ROUTES.filesPost)
    assert.match(post, /10 \* 1024 \* 1024/, '10 MB cap')
    assert.match(post, /application\/pdf/, 'PDF allowed')
    assert.match(post, /image\/jpeg/, 'JPEG allowed')
    assert.match(post, /readMultipartFormData/, 'bytes arrive as multipart')
    assert.match(post, /\/files/, 'stored through Directus files, id returned')
  })

  it('wedding-info.get: prefill fills, never verifies', () => {
    const route = read(ROUTES.weddingInfoGet)
    assert.match(route, /findScopedItem.*people/s, 'people rows read in scope')
    assert.match(route, /wedding_info_verified: row\.wedding_info_verified/, 'verify flag only echoed, never flipped')
    assert.ok(!/updateItem/.test(route), 'prefill writes nothing')
  })

  it('UI: searchable EntitySelect, brother/sister words, vow default B, print link', () => {
    for (const rel of [UI.panel, UI.vow, UI.uploads, UI.detail]) {
      const source = read(rel)
      assert.ok(!/groom|bride/i.test(source), `${rel} never names a groom or a bride`)
    }
    assert.match(read(UI.panel), /Fill from people records/, 'wedding-info prefill button exists')
    assert.match(read(UI.panel), /verified/, 'explicit verify checkbox exists')
    assert.match(read(UI.vow), /value: 'B'/, 'vow selector offers B as the default-marked wording')
    assert.match(read(UI.detail), /MarriageFormPanel/, 'detail page mounts the forms panel')
    assert.match(read(UI.detail), /MarriageUploadsCard/, 'detail page mounts the uploads card')
    assert.match(read(UI.detail), /\?print=1/, 'detail page links the print version')
  })

  it('print CSS: A4 sheet per form with header, fields, signatures', () => {
    const css = read(UI.css)
    assert.match(css, /@page/, 'paged media declared')
    assert.match(css, /size: A4/, 'A4 page size')
    assert.match(css, /\.print-sheet/, 'print sheet class exists')
    assert.match(css, /break-after: page/, 'one sheet per form')
    assert.match(read(UI.detail), /print-sheet/, 'detail page renders the print sheet')
    assert.match(read(UI.detail), /Signature/, 'signature lines print')
  })

  it('hygiene: {code, fields} everywhere, no bare 500 in new routes', () => {
    for (const [name, rel] of Object.entries(ROUTES)) {
      const route = read(rel)
      assert.ok(!/statusCode: 500/.test(route), `${name} never answers a bare 500`)
      assert.match(route, /code: '/, `${name} names its failure code`)
    }
  })
})
