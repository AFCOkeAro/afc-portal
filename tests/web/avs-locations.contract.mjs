/**
 * AFC-841 contract — AVS outreach locations register + page rework.
 *
 * AVS pointed at Bible Study Centres (wrong register; /bscs has no index
 * page). The register holds mission fields (schools, prisons, skills
 * centres, hospitals) with contact persons, visiting days and assigned
 * secretaries. Scope is route-stamped (0044 choice-8, no scope trigger).
 *
 * Run: node --test tests/web/avs-locations.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261028_0051_outreach_locations.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0051_outreach_locations.down.sql'
const NAV = 'apps/web/utils/navigation.ts'
const PAGE = 'apps/web/pages/avs.vue'

describe('AFC-841 outreach registers', () => {
  it('creates the locations table with closed category and ownership sets', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS outreach_locations/)
    assert.match(src, /primary_school/)
    assert.match(src, /secondary_school/)
    assert.match(src, /skills_centre/)
    assert.match(src, /ownership/)
  })

  it('creates the secretary junction with a once-per-location guard', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS outreach_location_secretaries/)
    assert.match(src, /UNIQUE \(location, person\)/)
    assert.match(src, /ON DELETE CASCADE/, 'assignments cascade with the location')
  })

  it('grants the add/remove verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON outreach_locations TO directus_app/)
    assert.match(src, /GRANT INSERT \(branch, zone, name, category/)
    assert.match(src, /GRANT DELETE ON outreach_locations TO directus_app/)
    assert.match(src, /GRANT DELETE ON outreach_location_secretaries TO directus_app/)
    assert.match(src, /REVOKE ALL ON outreach_locations FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops both tables when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back outreach locations/)
    assert.match(src, /DROP TABLE IF EXISTS outreach_location_secretaries/)
    assert.match(src, /DROP TABLE IF EXISTS outreach_locations/)
  })
})

describe('AFC-841 AVS page and nav', () => {
  it('the Admin AVS entry is gone and Outreach AVS points at /avs', () => {
    const src = codeOf(NAV)
    assert.doesNotMatch(src, /to: '\/bscs'/)
    assert.match(src, /to: '\/avs'/)
  })

  it('the page lists locations with contacts and manages secretaries', () => {
    const src = codeOf(PAGE)
    assert.match(src, /OUTREACH_LOCATION_CATEGORIES/)
    assert.match(src, /assignSecretary/)
    assert.match(src, /unassignSecretary/)
    assert.match(src, /Outreach List/, 'the current outreach list stays linked')
  })

  it('assignment routes scope-gate both sides', () => {
    const src = codeOf(
      'apps/web/server/api/outreach-locations/[id]/secretaries/index.post.ts',
    )
    assert.match(src, /findScopedItem/)
  })
})
