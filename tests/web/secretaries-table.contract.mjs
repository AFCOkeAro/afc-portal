/**
 * AFC-913 contract — secretaries table with a schools-visited column.
 *
 * Secretaries are one row per assigned person with the schools they visit
 * (one person can visit many schools); people with no assignment have no
 * roster record, so the table shows assigned secretaries and the person
 * picker adds anyone. GET /api/outreach-secretaries serves the whole-table
 * read (distinct assigned people + their schools from the junction, scoped
 * reads); the AVS Secretaries tab renders that table with per-school
 * unassign and assign controls. No new registers: the 0051 junction
 * already supports the M2M shape, so no DDL ships here.
 *
 * Run: node --test tests/web/secretaries-table.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const ENDPOINT = 'apps/web/server/api/outreach-secretaries/index.get.ts'
const PAGE = 'apps/web/pages/avs.vue'

describe('AFC-913 outreach-secretaries endpoint', () => {
  it('serves the whole-table read from the junction, scoped to the caller', () => {
    const src = codeOf(ENDPOINT)
    assert.match(src, /outreach_location_secretaries/)
    assert.match(src, /requireCan\(scope, 'outreach_location_secretaries', 'read'/)
    assert.match(src, /requireCan\(scope, 'outreach_locations', 'read'/)
    assert.match(src, /scopeFilter\(scope\)/, 'locations stay branch-scoped')
    assert.match(
      src,
      /location: \{ _in:/,
      'the junction read is narrowed to in-scope locations',
    )
  })

  it('returns one row per person with their schools, names resolved server-side', () => {
    const src = codeOf(ENDPOINT)
    assert.match(src, /byPerson/, 'rows group by distinct person')
    assert.match(src, /schools\.push\(\{\s*id: location,\s*name:/)
    assert.match(src, /preferred_name/, 'the [id] name enrichment pattern')
    assert.match(src, /localeCompare/, 'rows and schools sort by name')
  })

  it('names its store errors after the 0051 migration, never a bare 500', () => {
    const src = codeOf(ENDPOINT)
    assert.match(src, /throwStoreUnavailable\(error, 'outreach_store', '0051'\)/)
    assert.doesNotMatch(src, /statusCode: 500/)
  })
})

describe('AFC-913 AVS Secretaries table', () => {
  it('renders one row per secretary with a schools-visited column', () => {
    const src = codeOf(PAGE)
    assert.match(src, /\/api\/outreach-secretaries/)
    assert.match(src, /secretaryTableRows/)
    assert.match(src, /Schools visited/)
    assert.match(src, /secretaryTable\.value\.filter/, 'the location picker filters rows')
  })

  it('each school chip unassigns just that school', () => {
    const src = codeOf(PAGE)
    assert.match(src, /unassignSecretary\(school\.id, row\.person\)/)
    assert.match(src, /Unassign \$\{row\.name\} from \$\{school\.name\}/)
  })

  it('assign controls cover a new school per row and anyone via the picker', () => {
    const src = codeOf(PAGE)
    assert.match(src, /assignSchoolToPerson\(row\.person\)/)
    assert.match(src, /Add a secretary/)
    assert.match(src, /assignPerson\[newSecretaryLocation\]/, 'the picker adds anyone')
    assert.match(src, /assignSecretary\(newSecretaryLocation\)/)
  })

  it('per-location assign and unassign keep working', () => {
    const src = codeOf(PAGE)
    assert.match(src, /assignSecretary/)
    assert.match(src, /unassignSecretary/)
    assert.match(src, /\/api\/outreach-locations\/.*\/secretaries/)
  })
})

describe('AFC-913 ships no DDL', () => {
  it('no migration beyond the 0051 outreach pair touches secretaries', () => {
    const dirs = [
      'services/directus/schema/migrations',
      'services/directus/schema/migrations/rollback',
    ]
    const found = dirs.flatMap((dir) =>
      readdirSync(path.join(root, dir)).filter((file) => /secretar/i.test(file)),
    )
    assert.deepEqual(found.sort(), [])
  })
})
