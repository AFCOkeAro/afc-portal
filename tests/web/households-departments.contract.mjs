/**
 * AFC-469 contract tests — households + departments staff UI/API and
 * person-profile links (AFC-462 Slice 2 workstream A).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Zod schemas cover the household form (name, branch, address,
 *     wedding_date, household_head, phone) plus member-link validation for
 *     both junctions, and are exported from the shared barrel.
 *  2. Staff routes mirror the `people/*` patterns: branch-scoped reads,
 *     capability gates via requireCan, member lists included on detail, and
 *     link/unlink through `people.household` + `people_departments` rows.
 *  3. Household moves across households are a 409 (unlink first); department
 *     unlink deactivates instead of deleting; re-link reactivates.
 *  4. The department list keeps the area-wide (null-branch) visibility grant
 *     without leaking foreign branches.
 *  5. UI pages link both ways (person -> household -> members) with the
 *     department filter on the people list, all behind capabilities.
 *
 * Run: node --test tests/web/households-departments.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('schemas: household form and member-link validation', () => {
  const schema = read('packages/shared/src/schemas/household.ts')
  const department = read('packages/shared/src/schemas/department.ts')
  const barrel = read('packages/shared/src/schemas/index.ts')

  it('covers the staff household form fields from the issue', () => {
    for (const field of [
      'name',
      'branch',
      'address',
      'wedding_date',
      'household_head',
      'phone',
    ]) {
      assert.ok(schema.includes(field), `household form names ${field}`)
    }
  })

  it('requires a name and validates the phone like the person form', () => {
    assert.match(schema, /name: z\.string\(\)\.trim\(\)\.min\(1/)
    assert.match(schema, /phoneSchema/)
  })

  it('offers a partial patch schema that rejects empty updates', () => {
    assert.match(schema, /householdPatchSchema/)
    assert.match(schema, /Nothing to update/)
  })

  it('validates the household member link as exactly one person uuid', () => {
    assert.match(schema, /householdMemberLinkSchema/)
    assert.match(schema, /person: uuidSchema/)
  })

  it('validates the department link with the junction roles', () => {
    assert.match(department, /departmentMemberLinkSchema/)
    assert.match(department, /'member', 'leader', 'assistant'/)
    assert.match(department, /departmentMemberUnlinkSchema/)
  })

  it('exports both modules from the shared barrel', () => {
    assert.ok(barrel.includes("'./household'"), 'barrel exports household')
    assert.ok(barrel.includes("'./department'"), 'barrel exports department')
  })

  it('unlink deactivates so history survives (documented in the schema)', () => {
    assert.match(department, /inactive/)
  })
})

describe('household routes: branch-scoped CRUD with members included', () => {
  it('list requires the read grant and applies the branch scope', () => {
    const src = codeOf('apps/web/server/api/households/index.get.ts')
    assert.match(src, /requireCan\(scope, 'households', 'read'\)/)
    assert.match(src, /scopeFilter\(scope\)/)
  })

  it('list includes a per-household member count in one junction read', () => {
    const src = codeOf('apps/web/server/api/households/index.get.ts')
    assert.match(src, /member_count/)
    assert.match(src, /household: \{ _in: ids \}/)
  })

  it('create validates the form, resolves the branch and checks the head', () => {
    const src = codeOf('apps/web/server/api/households/index.post.ts')
    assert.match(src, /requireCan\(scope, 'households', 'create'\)/)
    assert.match(src, /householdFormSchema\.safeParse/)
    assert.match(src, /resolveBranch\(scope, form\.branch\)/)
    assert.match(src, /household_head/)
    assert.match(src, /findScopedItem/)
  })

  it('detail includes the scoped member list and the head name', () => {
    const src = codeOf('apps/web/server/api/households/[id].get.ts')
    assert.match(src, /requireCan\(scope, 'households', 'read'\)/)
    assert.match(src, /household: \{ _eq: id \}/)
    assert.match(src, /scopeFilter\(scope\)/)
    assert.match(src, /head_name/)
    assert.match(src, /is_head/)
  })

  it('records that household-head own-only lives in the Directus policy', () => {
    // Raw read: codeOf strips comments, and this decision is recorded in one.
    const src = read('apps/web/server/api/households/[id].get.ts')
    assert.match(src, /household-head own-only/)
    assert.match(src, /Directus/)
  })

  it('patch requires update and accepts a partial form', () => {
    const src = codeOf('apps/web/server/api/households/[id].patch.ts')
    assert.match(src, /requireCan\(scope, 'households', 'update'\)/)
    assert.match(src, /householdPatchSchema\.safeParse/)
  })

  it('link needs both grants and refuses cross-household moves with 409', () => {
    const src = codeOf('apps/web/server/api/households/[id]/members.post.ts')
    assert.match(src, /requireCan\(scope, 'households', 'update'\)/)
    assert.match(src, /requireCan\(scope, 'people', 'update'\)/)
    assert.match(src, /statusCode: 409/)
    assert.match(src, /household_conflict/)
  })

  it('unlink clears the field and drops a dangling head pointer', () => {
    const src = codeOf('apps/web/server/api/households/[id]/members.delete.ts')
    assert.match(src, /requireCan\(scope, 'households', 'update'\)/)
    assert.match(src, /requireCan\(scope, 'people', 'update'\)/)
    assert.match(src, /household: null/)
    assert.match(src, /household_head: null/)
  })
})

describe('department routes: area-wide visibility with scoped members', () => {
  it('shares the nullable-branch scope helper with events', () => {
    const src = codeOf('apps/web/server/utils/portal.ts')
    assert.match(src, /departmentScopeFilter/)
    assert.match(
      src,
      /\{ branch: \{ _in: scope\.branchIds \} \}, \{ branch: \{ _null: true \} \}/,
    )
  })

  it('list requires read and keeps area-wide departments visible', () => {
    const src = codeOf('apps/web/server/api/departments/index.get.ts')
    assert.match(src, /requireCan\(scope, 'departments', 'read'\)/)
    assert.match(src, /departmentScopeFilter\(scope\)/)
  })

  it('list rejects an explicitly out-of-scope branch with 403', () => {
    const src = codeOf('apps/web/server/api/departments/index.get.ts')
    assert.match(src, /branch_out_of_scope/)
    assert.match(src, /statusCode: 403/)
  })

  it('detail resolves members through the junction inside the people scope', () => {
    const src = codeOf('apps/web/server/api/departments/[id].get.ts')
    assert.match(src, /requireCan\(scope, 'departments', 'read'\)/)
    assert.match(src, /people_departments/)
    assert.match(src, /scopeFilter\(scope\)/)
    assert.match(src, /member_count/)
  })

  it('link requires the junction create grant and reactivates past members', () => {
    const src = codeOf('apps/web/server/api/departments/[id]/members.post.ts')
    assert.match(src, /requireCan\(scope, 'people_departments', 'create'\)/)
    assert.match(src, /reactivated/)
    assert.match(src, /joined_at/)
  })

  it('unlink deactivates under the update grant, never deletes', () => {
    const src = codeOf('apps/web/server/api/departments/[id]/members.delete.ts')
    assert.match(src, /requireCan\(scope, 'people_departments', 'update'\)/)
    assert.match(src, /status: 'inactive'/)
    assert.doesNotMatch(src, /deleteItem/)
  })
})

describe('people routes: department filter and profile links', () => {
  it('people list resolves ?department= through the junction with a read gate', () => {
    const src = codeOf('apps/web/server/api/people/index.get.ts')
    assert.match(src, /requireCan\(scope, 'departments', 'read'\)/)
    assert.match(src, /people_departments/)
    assert.match(src, /departmentPersonIds/)
    assert.match(src, /id: \{ _in: departmentPersonIds \}/)
  })

  it('person detail carries the household name and department memberships', () => {
    const src = codeOf('apps/web/server/api/people/[id].get.ts')
    assert.match(src, /household_name/)
    assert.match(src, /people_departments/)
    assert.match(src, /departments: memberships/)
  })
})

describe('UI: two-way links behind capabilities, no role names', () => {
  it('ships household list and detail pages plus department list and detail', () => {
    for (const page of [
      'apps/web/pages/households/index.vue',
      'apps/web/pages/households/[id].vue',
      'apps/web/pages/departments/index.vue',
      'apps/web/pages/departments/[id].vue',
      'apps/web/components/HouseholdFormModal.vue',
    ]) {
      assert.ok(existsSync(path.join(root, page)), `${page} exists`)
    }
  })

  it('gates household and department UI on capabilities, never roles', () => {
    const pages = [
      'apps/web/pages/households/index.vue',
      'apps/web/pages/households/[id].vue',
      'apps/web/pages/departments/[id].vue',
    ].map((rel) => codeOf(rel))
    for (const src of pages) {
      assert.doesNotMatch(src, /branch_admin|department_leader|area_admin/)
    }
    assert.match(
      pages[0],
      /PermissionGate :collection="COLLECTIONS\.households" action="create"/,
    )
  })

  it('links person -> household -> members both ways', () => {
    // Raw reads: codeOf strips `//` comments, which would also eat the `//`
    // inside a template URL. These assertions need the unstripped source.
    const profile = read('apps/web/pages/people/[id].vue')
    assert.match(profile, /households\/\$\{person\.household\}/)
    assert.match(profile, /person\.household_name/)
    assert.match(profile, /departments\/\$\{membership\.id\}/)
    const detail = read('apps/web/pages/households/[id].vue')
    assert.match(detail, /people\/\$\{member\.id\}/)
    const dept = read('apps/web/pages/departments/[id].vue')
    assert.match(dept, /people\/\$\{member\.id\}/)
  })

  it('filters the people list by department', () => {
    const src = codeOf('apps/web/pages/people/index.vue')
    assert.match(src, /department\.value !== 'all'/)
    assert.match(src, /departmentOptions/)
    assert.match(src, /\/api\/departments/)
  })

  it('adds Households and Departments to capability-driven navigation', () => {
    const src = codeOf('apps/web/utils/navigation.ts')
    assert.match(src, /to: '\/households'/)
    assert.match(src, /requires: \['households', 'read'\]/)
    assert.match(src, /to: '\/departments'/)
    assert.match(src, /requires: \['departments', 'read'\]/)
  })

  it('shows address text only on the household contact card', () => {
    const src = codeOf('apps/web/pages/households/[id].vue')
    assert.match(src, /map pin is deferred/)
  })
})

describe('household/department routes: unreadable store fails named, never bare 500 (AFC-566)', () => {
  const householdList = codeOf('apps/web/server/api/households/index.get.ts')
  const householdDetail = codeOf('apps/web/server/api/households/[id].get.ts')
  const householdPost = codeOf('apps/web/server/api/households/index.post.ts')
  const householdPatch = codeOf('apps/web/server/api/households/[id].patch.ts')
  const householdLink = codeOf('apps/web/server/api/households/[id]/members.post.ts')
  const householdUnlink = codeOf(
    'apps/web/server/api/households/[id]/members.delete.ts',
  )
  const deptList = codeOf('apps/web/server/api/departments/index.get.ts')
  const deptDetail = codeOf('apps/web/server/api/departments/[id].get.ts')
  const deptLink = codeOf('apps/web/server/api/departments/[id]/members.post.ts')
  const deptUnlink = codeOf('apps/web/server/api/departments/[id]/members.delete.ts')

  it('household list/detail wrap the 0020 register in the named store error', () => {
    assert.match(
      householdList,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
    assert.match(
      householdDetail,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
  })

  it('household create/patch wrap the 0020 register in the named store error', () => {
    assert.match(
      householdPost,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
    assert.match(
      householdPatch,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
  })

  it('household link/unlink keep the 409/404 semantics under the named error', () => {
    assert.match(
      householdLink,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
    assert.match(householdLink, /household_conflict/)
    assert.match(
      householdUnlink,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
    assert.match(householdUnlink, /not a member of this household/)
  })

  it('department list/detail wrap the 0020 register in the named store error', () => {
    assert.match(deptList, /throwStoreUnavailable\(error, 'department_store', '0020'\)/)
    assert.match(
      deptDetail,
      /throwStoreUnavailable\(error, 'department_store', '0020'\)/,
    )
  })

  it('department link/unlink wrap the junction in the named store error', () => {
    assert.match(deptLink, /throwStoreUnavailable\(error, 'department_store', '0020'\)/)
    assert.match(
      deptUnlink,
      /throwStoreUnavailable\(error, 'department_store', '0020'\)/,
    )
    assert.match(deptUnlink, /not an active member of this department/)
  })

  it('deliberate 4xx pass through instead of being renamed into the store', () => {
    for (const src of [
      householdList,
      householdPost,
      householdPatch,
      householdLink,
      householdUnlink,
      deptList,
      deptDetail,
      deptLink,
      deptUnlink,
    ]) {
      assert.match(src, /statusCode\?\: number \}\)\?\.statusCode\) throw error/)
    }
  })

  it('household detail passes through only 4xx; 5xx maps to the named store error (AFC-654)', () => {
    assert.match(
      householdDetail,
      /status >= 400 && status < 500\) throw error/,
    )
    assert.match(
      householdDetail,
      /throwStoreUnavailable\(error, 'household_store', '0020'\)/,
    )
  })

  it('household detail validates the id shape at the boundary (AFC-654)', () => {
    assert.match(
      householdDetail,
      /assertUuidParam\(getRouterParam\(event, 'id'\), 'household', 'invalid_household_id'\)/,
    )
    assert.doesNotMatch(householdDetail, /A household id is required/)
  })

  it('the uuid boundary guard answers 400 with a named code (AFC-654)', () => {
    const src = codeOf('apps/web/server/utils/portal.ts')
    assert.match(src, /export function assertUuidParam/)
    assert.match(src, /statusCode: 400/)
    assert.match(src, /is not valid/)
    assert.match(src, /data: \{ code \}/)
  })

  it('the Directus layer strips upstream detail from 5xx messages (AFC-654)', () => {
    const src = codeOf('apps/web/server/utils/directus.ts')
    assert.match(src, /if \(status >= 500 \|\| status < 400\)/)
    assert.match(src, /statusMessage: `Directus request to \$\{path\} failed`,/)
  })

  it('no route embeds raw SQL in an error body (AFC-654)', () => {
    for (const rel of [
      'apps/web/server/api/households/[id].get.ts',
      'apps/web/server/utils/directus.ts',
      'apps/web/server/utils/portal.ts',
    ]) {
      const src = read(rel)
      assert.doesNotMatch(src, /select\s+.*\s+from\s+/i)
      assert.doesNotMatch(src, /invalid input syntax/i)
    }
  })

  it('the 0020 migration owns exactly the tables these routes assume', () => {
    const migration = read(
      'services/directus/schema/migrations/20261020_0020_households_departments.sql',
    )
    assert.match(migration, /CREATE TABLE IF NOT EXISTS households/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS departments/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS people_departments/)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS household/)
  })
})
