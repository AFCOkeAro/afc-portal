/**
 * AFC-914 contract — Roles People tab: all persons with system roles plus
 * add-person with permission level and coverage.
 *
 * - GET /api/admin/users with no search lists the role holders (staff_role
 *   set and not `none`); search narrows as before. Same area gate, same
 *   fields, never password hashes.
 * - POST /api/admin/users invites a new person (email + name), assigns the
 *   permission level (staff role -> Directus role, same mapping as PATCH)
 *   and coverage (area/zone/branch, AVS/BSC resolving to the parent branch,
 *   modules derived from the role and never stored). Invite-then-patch, no
 *   password anywhere, duplicate email is a 409.
 * - People tab auto-loads holders on first visit, shows a coverage column,
 *   and offers an add-person modal with role + coverage pickers and a
 *   read-only modules preview.
 * - No new register or store: AVS/BSC hang off branches, modules derive
 *   from the role matrix, so this stays apps-only with no migration.
 *
 * Run: node --test tests/web/roles-people-914.contract.mjs
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

const GET = 'apps/web/server/api/admin/users/index.get.ts'
const POST = 'apps/web/server/api/admin/users/index.post.ts'
const PATCH = 'apps/web/server/api/admin/users/[id].patch.ts'
const UI = 'apps/web/pages/admin/roles.vue'

describe('AFC-914 holders list', () => {
  it('an empty query lists role holders, not an arbitrary page', () => {
    const src = codeOf(GET)
    assert.match(src, /staff_role: \{ _nnull: true \}/)
    assert.match(src, /staff_role: \{ _neq: 'none' \}/)
    assert.match(src, /sort: 'email'/)
    assert.match(src, /limit: 100/)
  })

  it('search still narrows by name or email with the old page size', () => {
    const src = codeOf(GET)
    assert.match(src, /search,/)
    assert.match(src, /limit: 25/)
  })

  it('keeps the area gate and never leaks credentials', () => {
    const src = codeOf(GET)
    assert.match(src, /requireArea\(event\)/)
    assert.match(
      src,
      /fields: 'id,email,first_name,last_name,staff_role,status,branch,zone,area'/,
    )
    assert.doesNotMatch(src, /password/i)
  })
})

describe('AFC-914 add-person endpoint', () => {
  it('is gated like the assignment PATCH (area), not widened', () => {
    const src = codeOf(POST)
    assert.match(src, /requireArea\(event\)/)
    assert.doesNotMatch(src, /requireSuperAdmin/)
  })

  it('requires identity and a permission level', () => {
    const src = codeOf(POST)
    assert.match(src, /A valid email address is required/)
    assert.match(src, /A staff role is required/)
  })

  it('maps built-ins to the seeded Directus roles, like PATCH', () => {
    const src = codeOf(POST)
    assert.match(src, /super_admin: 'Administrator'/)
    assert.match(src, /branch_admin: 'Branch Admin'/)
    assert.match(src, /No Directus role named.*create it on the Roles tab first/)
  })

  it('refuses duplicates with a 409 instead of silently updating', () => {
    const src = codeOf(POST)
    assert.match(src, /statusCode: 409/)
    assert.match(src, /already_exists/)
  })

  it('invites then stamps role + scope, never handling a password', () => {
    const src = codeOf(POST)
    assert.match(src, /\/users\/invite/)
    assert.match(src, /body: \{ email, role: roleId \}/)
    assert.match(src, /staff_role: staffRole/)
    assert.match(src, /branch_ids: branch \? \[branch\] : \[\]/)
    assert.match(src, /zone_ids: zone \? \[zone\] : \[\]/)
    assert.doesNotMatch(src, /password/i)
  })

  it('resolves AVS/BSC coverage to the parent branch and refuses conflicts', () => {
    const src = codeOf(POST)
    assert.match(src, /\/items\/outreach_locations\//)
    assert.match(src, /\/items\/bscs\//)
    assert.match(src, /Coverage branches disagree/)
    assert.match(src, /\/items\/branches\//)
    assert.match(src, /\/items\/zones\//)
  })
})

describe('AFC-914 People tab UI', () => {
  it('auto-loads every holder on first visit', () => {
    const src = codeOf(UI)
    assert.match(src, /ensurePeopleLookups/)
    assert.match(src, /holdersLoaded/)
    assert.match(src, /watch\(tab/)
  })

  it('offers an add-person modal with permission level and coverage', () => {
    const src = codeOf(UI)
    assert.match(src, /Add person/)
    assert.match(src, /openAdder/)
    assert.match(src, /createUser/)
    assert.match(src, /Permission level \(staff role\)/)
    assert.match(src, /Area coverage/)
    assert.match(src, /Zone coverage/)
    assert.match(src, /Branch coverage/)
    assert.match(src, /AVS coverage/)
    assert.match(src, /BSC coverage/)
  })

  it('previews modules from the role instead of storing them', () => {
    const src = codeOf(UI)
    assert.match(src, /addModules/)
    assert.match(src, /Modules included/)
    assert.match(src, /Derived from the permission level/)
  })

  it('shows a coverage column on the holders table', () => {
    const src = codeOf(UI)
    assert.match(src, /coverageLabel/)
    assert.match(src, /Coverage/)
  })

  it('the add flow posts to the new endpoint and reloads holders', () => {
    const src = codeOf(UI)
    assert.match(src, /api\.post\('\/api\/admin\/users'/)
    assert.match(src, /avs_location/)
  })
})

describe('AFC-914 stays apps-only', () => {
  it('adds no migration and no new directus_users store', () => {
    const dir = path.join(root, 'services/directus/schema/migrations')
    const names = readdirSync(dir)
    assert.equal(
      names.filter((name) => name.includes('914')).length,
      0,
      'coverage needs no new register; a 914 migration would be compliance-path',
    )
    assert.doesNotMatch(codeOf(POST), /ALTER TABLE directus_users/)
    assert.doesNotMatch(codeOf(GET), /ALTER TABLE/)
  })

  it('does not widen permission gates beyond the PATCH precedent', () => {
    assert.match(codeOf(PATCH), /requireArea\(event\)/)
    assert.match(codeOf(POST), /requireArea\(event\)/)
  })
})
