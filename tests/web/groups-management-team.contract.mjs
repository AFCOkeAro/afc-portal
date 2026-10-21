/**
 * AFC-593 contract tests — Area-HQ Groups 1-4, multi-level departments,
 * management-team rollup (parent AFC-460).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Migration 0027 extends departments with zone/area + widens the type
 *     set (group + music/security/kitchen/sanitation/elementary) and seeds
 *     Groups 1-4 idempotently under fixed codes (no parallel table).
 *  2. The department scope helper opens granted zone/area levels and keeps
 *     the fully-unscoped area-wide grant; unknown levels stay closed.
 *  3. Department list/detail carry the new scope fields; explicit
 *     zone/area narrowing fails closed with 403 (mirroring the branch
 *     pattern); no new write paths appear.
 *  4. The management-team endpoint is a read-only rollup (leaders via the
 *     junction role=leader + leader_person pointer, names/phones per the
 *     department detail's existing contact scope) with per-level 403s.
 *
 * Run: node --test tests/web/groups-management-team.contract.mjs
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

describe('migration 0027: scope columns, widened types, Group 1-4 seed', () => {
  const migration = read(
    'services/directus/schema/migrations/20261020_0027_groups_multilevel_departments.sql',
  )

  it('adds zone + area as nullable SET NULL links, never a new table', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS zone/)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS area/)
    assert.match(migration, /ON DELETE SET NULL/)
    assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS departments/)
  })

  it('holds one level per row with a fixed-name scope CHECK', () => {
    assert.match(migration, /departments_single_scope_check/)
    assert.match(migration, /branch IS NOT NULL/)
    assert.match(migration, /zone IS NOT NULL/)
  })

  it("widens the type set with 'group' plus the user-named ministries", () => {
    for (const type of ['group', 'music', 'security', 'kitchen', 'sanitation', 'elementary']) {
      assert.ok(migration.includes(`'${type}'`), `widened set names ${type}`)
    }
    assert.match(migration, /departments_type_widened_check/)
  })

  it('seeds Groups 1-4 idempotently under fixed codes, leaders via the junction', () => {
    for (const code of ['LAG-NORTH-GROUP-1', 'LAG-NORTH-GROUP-2', 'LAG-NORTH-GROUP-3', 'LAG-NORTH-GROUP-4']) {
      assert.ok(migration.includes(code), `seed names ${code}`)
    }
    assert.match(migration, /ON CONFLICT \(code\) DO NOTHING/)
    assert.match(migration, /role=leader/)
    assert.doesNotMatch(codeOf('services/directus/schema/migrations/20261020_0027_groups_multilevel_departments.sql'), /CREATE ROLE|CREATEROLE/)
  })

  it('grants only the two new scope columns, never DELETE rows or roles', () => {
    assert.match(migration, /GRANT INSERT \(zone, area\)/)
    assert.match(migration, /GRANT UPDATE \(zone, area\)/)
    assert.doesNotMatch(migration, /DELETE FROM departments/)
    assert.doesNotMatch(migration, /GRANT DELETE/)
  })
})

describe('department scope: zone/area levels mirror the branch pattern', () => {
  it('opens granted zone/area rows plus the fully-unscoped grant, nothing else', () => {
    const src = codeOf('apps/web/server/utils/portal.ts')
    const raw = read('apps/web/server/utils/portal.ts')
    assert.match(src, /export function departmentScopeFilter/)
    assert.match(src, /\{ branch: \{ _in: scope\.branchIds \} \}/)
    assert.match(src, /\{ zone: \{ _in: scope\.zoneIds \} \}/)
    assert.match(src, /\{ area: \{ _eq: scope\.areaId \} \}/)
    assert.match(src, /\{ branch: \{ _null: true \} \}/)
    assert.match(raw, /fail-closed/)
  })

  it('carries zone + area on the shared Department type', () => {
    const src = read('packages/shared/src/types.ts')
    assert.match(src, /zone: string \| null/)
    assert.match(src, /area: string \| null/)
    assert.ok(src.includes("'group'"), "type names 'group'")
  })

  it('lists with zone/area fields and fail-closed narrowing', () => {
    const src = codeOf('apps/web/server/api/departments/index.get.ts')
    assert.match(src, /'zone'/)
    assert.match(src, /'area'/)
    assert.match(src, /zone_out_of_scope/)
    assert.match(src, /area_out_of_scope/)
    assert.match(src, /statusCode: 403/)
  })

  it('details carry the scope fields under the existing scope predicate', () => {
    const src = codeOf('apps/web/server/api/departments/[id].get.ts')
    assert.match(src, /'zone'/)
    assert.match(src, /'area'/)
    assert.match(src, /departmentScopeFilter\(scope\)/)
  })

  it('adds no department write paths beyond the existing junction link/unlink', () => {
    const src = codeOf('apps/web/server/api/departments/index.get.ts')
    assert.doesNotMatch(src, /createItem|updateItem/)
  })
})

describe('management-team endpoint: read-only rollup per level', () => {
  const src = codeOf('apps/web/server/api/management-teams/index.get.ts')

  it('requires the level + id and the departments read grant', () => {
    assert.match(src, /requireCan\(scope, 'departments', 'read'\)/)
    assert.match(src, /level.*branch.*zone.*area/)
    assert.match(src, /statusCode: 400/)
  })

  it('rejects each out-of-scope level with its own 403', () => {
    assert.match(src, /branch_out_of_scope/)
    assert.match(src, /zone_out_of_scope/)
    assert.match(src, /area_out_of_scope/)
  })

  it('resolves leaders through the junction plus the leader_person pointer', () => {
    assert.match(src, /people_departments/)
    assert.match(src, /role: \{ _eq: 'leader' \}/)
    assert.match(src, /leader_person/)
    assert.match(src, /display_name/)
    assert.match(src, /branch_name/)
  })

  it('writes nothing: no create/update/delete imports or calls', () => {
    assert.doesNotMatch(src, /createItem|updateItem|deleteItem/)
  })
})

describe('management-team UI: read-only section on branch/zone/area pages', () => {
  it('ships one shared section component fed by the rollup endpoint', () => {
    const src = codeOf('apps/web/components/ManagementTeamSection.vue')
    assert.match(src, /\/api\/management-teams\?level=/)
    assert.match(src, /level: 'branch' \| 'zone' \| 'area'/)
    assert.match(src, /departments\/\$\{entry\.department\}/)
    assert.match(src, /people\/\$\{leader\.person\}/)
  })

  it('the section component issues no writes', () => {
    const src = codeOf('apps/web/components/ManagementTeamSection.vue')
    assert.doesNotMatch(src, /api\.post|api\.patch|api\.put|api\.delete/)
    assert.doesNotMatch(src, /\$fetch\(.*method: '(POST|PATCH|PUT|DELETE)'/)
  })

  it('encodes the rollup query params and pairs gray text with dark twins (AFC-609 nits)', () => {
    const src = codeOf('apps/web/components/ManagementTeamSection.vue')
    assert.match(src, /encodeURIComponent\(props\.level\)/)
    assert.match(src, /encodeURIComponent\(props\.scopeId\)/)
    assert.doesNotMatch(src, /text-gray-500"/)
    assert.match(src, /text-gray-500 dark:text-gray-400/)
  })

  it('branch, zone and area pages render it inside the gated leadership section', () => {
    const branch = codeOf('apps/web/pages/branches/[id].vue')
    assert.match(branch, /<ManagementTeamSection level="branch"/)
    const zone = codeOf('apps/web/pages/zones/[id].vue')
    assert.match(zone, /<ManagementTeamSection level="zone"/)
    const area = codeOf('apps/web/pages/areas/[id].vue')
    assert.match(area, /<ManagementTeamSection level="area"/)
    for (const src of [branch, zone, area]) {
      assert.match(src, /v-if="canLeadership"/)
    }
  })

  it('the shared portal types name the rollup rows', () => {
    const src = read('apps/web/types/portal.ts')
    assert.match(src, /ManagementTeamEntry/)
    assert.match(src, /ManagementTeamLeader/)
    assert.match(src, /display_name/)
  })
})
