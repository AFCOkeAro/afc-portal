/**
 * AFC-758 contract tests — departments as their own section with HQ group creation.
 *
 * No department reads change; the suite pins the new group-create path:
 * migration 0040 least-privilege grants (INSERT scoped columns, UPDATE
 * scoped columns, no DELETE anywhere), POST/PATCH group-only gating with
 * area scope, leader junction writes, duplicate-code 409, and the nav
 * entry. Suite 99 (tests/db/99_departments_group_write.sql) owns the
 * migration half; this file owns the route/UI half.
 *
 * Run: node --test tests/web/department-groups.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
const stripSql = (src) =>
  stripJs(src)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
const codeOf = (rel) => stripJs(read(rel))
const sqlOf = (rel) => stripSql(read(rel))

const MIGRATION =
  'services/directus/schema/migrations/20261023_0040_departments_group_write.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261023_0040_departments_group_write.down.sql'
const CREATE = 'apps/web/server/api/departments/index.post.ts'
const SCHEMA = 'packages/shared/src/schemas/department.ts'
const PATCH = 'apps/web/server/api/departments/[id].patch.ts'
const AREAS = 'apps/web/server/api/areas/index.get.ts'
const PAGE = 'apps/web/pages/departments/index.vue'
const NAV = 'apps/web/utils/navigation.ts'

describe('department groups — migration ceiling (AFC-758)', () => {
  it('grants INSERT/UPDATE over exactly the columns the portal writes', () => {
    const src = sqlOf(MIGRATION)
    assert.match(
      src,
      /GRANT INSERT \(id, name, code, department_type, branch, zone, area, leader_person, description, status\)/,
      'departments INSERT is column-scoped',
    )
    assert.match(
      src,
      /GRANT UPDATE \(name, code, description, status, leader_person\)/,
      'departments UPDATE excludes scope placement',
    )
    assert.match(
      src,
      /GRANT INSERT \(people, departments, role, joined_at, status\)/,
      'junction INSERT is column-scoped',
    )
    assert.match(
      src,
      /GRANT UPDATE \(role, status\)/,
      'junction UPDATE is role/status only',
    )
  })

  it('grants no DELETE anywhere and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.doesNotMatch(src, /GRANT DELETE/i, 'no DELETE granted')
    assert.doesNotMatch(src, /DROP TABLE/i, 'migration drops no tables')
    assert.match(
      src,
      /REVOKE ALL ON departments FROM PUBLIC/,
      'PUBLIC revoked on departments',
    )
    assert.match(
      src,
      /REVOKE ALL ON people_departments FROM PUBLIC/,
      'PUBLIC revoked on junction',
    )
  })

  it('the down script revokes exactly the added grants', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /REVOKE INSERT/, 'down revokes INSERT')
    assert.match(src, /REVOKE UPDATE/, 'down revokes UPDATE')
    assert.match(src, /FROM directus_app/, 'down targets the app role only')
  })
})

describe('department groups — routes (AFC-758)', () => {
  it('create is groups-only, area-scoped, with named failures', () => {
    const src = codeOf(CREATE)
    assert.match(
      src,
      /requireCan\(scope, 'departments', 'create'\)/,
      'create requires the grant',
    )
    assert.match(
      codeOf(SCHEMA),
      /z\.literal\('group'\)/,
      'schema admits only the group literal',
    )
    assert.match(src, /branch: null/, 'groups carry no branch')
    assert.match(src, /area_out_of_scope/, 'out-of-scope area is a named 403')
    assert.match(src, /code: 'conflict'/, 'duplicate code maps to a named 409')
  })

  it('create links the leader as a junction leader row', () => {
    const src = codeOf(CREATE)
    assert.match(src, /role: 'leader'/, 'leader row carries the leader role')
    assert.match(src, /people_departments/, 'link writes the junction')
  })

  it('patch is groups-only and never moves scope or type', () => {
    const src = codeOf(PATCH)
    assert.match(src, /department_type !== 'group'/, 'non-groups are refused')
    assert.match(src, /code: 'not_a_group'/, 'refusal carries a named code')
  })

  it('leader change demotes previous leaders', () => {
    const src = codeOf(PATCH)
    assert.match(src, /role: 'member'/, 'previous leaders are demoted to member')
  })

  it('areas list stays scoped and fail-closed', () => {
    const src = codeOf(AREAS)
    assert.match(src, /requireCan\(scope, 'areas', 'read'\)/, 'areas read is gated')
    assert.match(src, /status: \{ _eq: 'active' \}/, 'only active areas are offered')
  })
})

describe('department groups — section UI (AFC-758)', () => {
  it('the section has its own nav entry', () => {
    const src = codeOf(NAV)
    assert.match(src, /label: 'Departments'/, 'Departments nav entry exists')
    assert.match(src, /to: '\/departments'/, 'it opens the section page')
  })

  it('the index page offers group creation to grant holders', () => {
    const src = codeOf(PAGE)
    assert.match(src, /canCreateGroup/, 'creation UI is grant-gated')
    assert.match(src, /New group/, 'creation entry point is labelled')
    assert.match(src, /\/api\/departments/, 'creation posts the new route')
    assert.match(src, /already in use/, 'duplicate code surfaces the named conflict')
  })
})
