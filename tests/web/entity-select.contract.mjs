/**
 * AFC-631 contract tests — searchable entity selects everywhere.
 *
 * Shared component (apps/web/components/EntitySelect.vue) wrapping the kit
 * searchable select, plus grep gates over every consumer:
 *  1. EntitySelect wraps USelectMenu (type-to-filter, keyboard nav) with
 *     label/value items, loading + empty states, an error slot, and a
 *     documented server-search mode. It never fetches — options are the
 *     caller-scoped rows already passed to the form (no new data exposure).
 *  2. No USelect remains bound to an entity option list
 *     (branch/zone/person/department/record/programme/…) — those are all
 *     EntitySelect now. Static enums (gender, status, …) stay plain USelect.
 *  3. No raw manual-ID text inputs remain for entity references, except the
 *     three Directus *user*-id fields, which have no list endpoint to preload
 *     (no new endpoints in this slice): tasks assignee_user, invites
 *     inviter filter, visitor Welfare-officer assignment.
 *
 * Run: node --test tests/web/entity-select.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const ENTITY_OPTION_LISTS = [
  'branchOptions',
  'branchFilterOptions',
  'scopedBranches',
  'zoneOptions',
  'personOptions',
  'linkPersonOptions',
  'departmentOptions',
  'recordOptions',
  'programmeOptions',
  'slotOptions',
  'studentOptions',
  'eventOptions',
]

/** The only manual-ID inputs left: Directus user ids with no list endpoint. */
const USER_ID_EXCEPTIONS = [
  'apps/web/pages/tasks/index.vue', // form.assignee_user
  'apps/web/pages/invites/index.vue', // inviterFilter
  'apps/web/pages/visitors/[id].vue', // officerInput (Welfare position holder)
]

function vueFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.vue')) found.push(rel)
    }
  }
  walk('apps/web')
  return found
}

describe('AFC-631 EntitySelect component contract', () => {
  it('wraps the kit searchable select, not a plain select', () => {
    const code = codeOf('apps/web/components/EntitySelect.vue')
    assert.match(code, /<USelectMenu/, 'must render USelectMenu')
    assert.doesNotMatch(code, /<USelect[\s>]/, 'must not render plain USelect')
  })

  it('binds label/value items with type-to-filter', () => {
    const code = codeOf('apps/web/components/EntitySelect.vue')
    assert.match(code, /value-key="value"/, 'value-key="value"')
    assert.match(code, /label-key="label"/, 'label-key="label"')
    assert.match(code, /:search-input/, 'search input enabled (type-to-filter)')
    assert.match(code, /:filter-fields="\['label'\]"/, 'client filter runs over labels')
  })

  it('exposes loading, empty, and error states', () => {
    const code = codeOf('apps/web/components/EntitySelect.vue')
    assert.match(code, /#empty/, 'empty slot for no-match state')
    assert.match(code, /emptyText/, 'configurable empty text')
    assert.match(code, /loading/, 'loading prop disables + spins')
    assert.match(code, /slot name="error"/, 'error slot for field errors')
  })

  it('exposes v-model select contract and server-search escape hatch', () => {
    const code = codeOf('apps/web/components/EntitySelect.vue')
    assert.match(code, /update:modelValue/, 'v-model select emit')
    assert.match(code, /serverSearch\?: boolean/, 'server-search prop documented')
    assert.match(
      code,
      /:ignore-filter="serverSearch"/,
      'server mode disables client filter',
    )
    assert.match(code, /update:search-term/, 'server mode emits the typed term')
  })

  it('never fetches — option lists stay caller-scoped', () => {
    const code = codeOf('apps/web/components/EntitySelect.vue')
    assert.doesNotMatch(code, /useAsyncData/, 'no data fetching in the component')
    assert.doesNotMatch(code, /\$fetch|useApi\(\)/, 'no API access in the component')
  })
})

describe('AFC-631 migration gates', () => {
  it('no plain USelect remains bound to an entity option list', () => {
    const bad = []
    for (const rel of vueFiles()) {
      const text = read(rel)
      const tags = text.match(/<USelect\b[^>]*>/gs) ?? []
      for (const tag of tags) {
        if (ENTITY_OPTION_LISTS.some((name) => tag.includes(name))) {
          bad.push(`${rel}: ${tag.split('\n')[0].trim()}`)
        }
      }
    }
    assert.deepEqual(bad, [], `entity selects still plain:\n${bad.join('\n')}`)
  })

  it('static enums stay plain selects (not converted)', () => {
    let enumSelects = 0
    for (const rel of vueFiles()) {
      const text = read(rel)
      const tags = text.match(/<USelect\b[^>]*>/gs) ?? []
      enumSelects += tags.filter((tag) =>
        /genderOptions|statusOptions|typeOptions|priorityOptions|categoryOptions|membershipOptions/.test(
          tag,
        ),
      ).length
    }
    assert.ok(enumSelects > 0, 'static enum selects must remain plain USelect')
  })

  it('no manual-ID text inputs remain for entity references', () => {
    const idInput = /<UInput\b[^>]*>/gs
    const entityIdHint =
      /uuid|person id|branch id|event id|student id|slot id|programme id|identifier/i
    const bad = []
    for (const rel of vueFiles()) {
      if (USER_ID_EXCEPTIONS.includes(rel)) continue
      const text = read(rel)
      for (const tag of text.match(idInput) ?? []) {
        if (entityIdHint.test(tag)) bad.push(`${rel}: ${tag.slice(0, 120)}`)
      }
    }
    assert.deepEqual(bad, [], `manual-ID entity inputs remain:\n${bad.join('\n')}`)
  })

  it('the only manual-ID exceptions are Directus user ids (no list endpoint)', () => {
    for (const rel of USER_ID_EXCEPTIONS) {
      const text = read(rel)
      assert.match(
        text,
        /assignee_user|inviterFilter|officerInput/,
        `${rel} still holds its documented user-id input`,
      )
    }
  })
})
