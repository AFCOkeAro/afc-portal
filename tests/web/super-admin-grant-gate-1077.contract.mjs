/**
 * AFC-1077 contract — super_admin self-grant gate on the user admin routes.
 *
 * Finding: POST /api/admin/users and PATCH /api/admin/users/:id used
 * requireArea (passes for area_admin AND super_admin) yet accepted
 * staff_role=super_admin, mapping it to the Directus Administrator system
 * role — which bypasses every Directus policy. Any area admin could therefore
 * mint or promote a super_admin. The fix gates that one assignment behind
 * requireSuperAdmin; area admins keep every other role assignment.
 *
 * - Both user routes keep the area gate AND call requireSuperAdmin when the
 *   requested staff role is super_admin (either spelling the selects submit:
 *   `super_admin` or the `Administrator` display name). An area_admin asking
 *   for super_admin gets a 403; a super_admin still passes.
 * - The People-tab selects hide the super_admin option for non-super admins.
 *   The server remains the control; the UI is convenience only.
 * - The leave matrix is unchanged: super_admin still holds ALL on
 *   leave_requests/leave_balances by design, and the leave create route still
 *   enforces requireCan — nothing in the leave path is widened or narrowed.
 *
 * Run: node --test tests/web/super-admin-grant-gate-1077.contract.mjs
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

const POST = 'apps/web/server/api/admin/users/index.post.ts'
const PATCH = 'apps/web/server/api/admin/users/[id].patch.ts'
const GUARD = 'apps/web/server/utils/admin-guard.ts'
const UI = 'apps/web/pages/admin/roles.vue'
const MATRIX = 'packages/shared/src/role-matrix.ts'
const LEAVE_POST = 'apps/web/server/api/leave-requests/index.post.ts'

describe('AFC-1077 super_admin assignment gate (POST)', () => {
  it('keeps the area gate for the general path', () => {
    const src = codeOf(POST)
    assert.match(src, /requireArea\(event\)/)
  })

  it('calls requireSuperAdmin when the requested role is super_admin', () => {
    const src = codeOf(POST)
    assert.match(src, /requireSuperAdmin/)
    assert.match(src, /requireSuperAdmin\(event\)/)
    assert.match(src, /staffRole === 'super_admin'/)
  })

  it('covers the Administrator display-name spelling the selects submit', () => {
    const src = codeOf(POST)
    assert.match(src, /Administrator/)
  })

  it('the gate runs before any Directus write', () => {
    const src = codeOf(POST)
    const gate = src.indexOf('requireSuperAdmin(event)')
    const write = src.indexOf('/users/invite')
    assert.ok(
      gate !== -1 && write !== -1 && gate < write,
      'gate precedes the invite write',
    )
  })
})

describe('AFC-1077 super_admin assignment gate (PATCH)', () => {
  it('keeps the area gate for the general path', () => {
    const src = codeOf(PATCH)
    assert.match(src, /requireArea\(event\)/)
  })

  it('calls requireSuperAdmin when the requested role is super_admin', () => {
    const src = codeOf(PATCH)
    assert.match(src, /requireSuperAdmin/)
    assert.match(src, /requireSuperAdmin\(event\)/)
    assert.match(src, /staffRole === 'super_admin'/)
  })

  it('the gate runs before the Directus patch write', () => {
    const src = codeOf(PATCH)
    const gate = src.indexOf('requireSuperAdmin(event)')
    const write = src.indexOf("method: 'PATCH'")
    assert.ok(gate !== -1 && write !== -1 && gate < write, 'gate precedes the user write')
  })
})

describe('AFC-1077 gate behaviour', () => {
  it('requireSuperAdmin refuses non-super_admin actors with a 403', () => {
    const src = codeOf(GUARD)
    assert.match(src, /staffRole !== 'super_admin'/)
    assert.match(src, /statusCode: 403/)
  })

  it('area admins keep every other role assignment (gate is conditional)', () => {
    for (const rel of [POST, PATCH]) {
      const src = codeOf(rel)
      const cond = src.indexOf("staffRole === 'super_admin'")
      const gate = src.indexOf('requireSuperAdmin(event)')
      assert.ok(
        cond !== -1 && gate !== -1 && cond < gate,
        `${rel}: the super_admin gate fires only for a super_admin request`,
      )
    }
  })
})

describe('AFC-1077 People-tab UI', () => {
  it('hides the super_admin option for non-super_admin sessions', () => {
    const src = codeOf(UI)
    assert.match(src, /isSuperAdmin/)
    assert.match(src, /role\.name !== 'super_admin'/)
    assert.match(src, /role\.name !== 'Administrator'/)
  })

  it('both staff-role selects share the filtered options', () => {
    const src = codeOf(UI)
    const uses = src.match(/:items="roleOptions"/g) ?? []
    assert.equal(uses.length, 2, 'edit + add selects both use the filtered roleOptions')
  })
})

describe('AFC-1077 leave matrix unchanged', () => {
  it('super_admin still holds ALL on the leave registers by design', () => {
    const src = read(MATRIX)
    for (const collection of ['leaveRequests', 'leaveBalances']) {
      const at = src.indexOf(`[COLLECTIONS.${collection}]`)
      assert.ok(at !== -1, `${collection} is still in the matrix`)
      const cell = src.slice(at, at + 400)
      assert.match(cell, /super_admin: \[ALL, 'all'\]/)
    }
  })

  it('the leave create route still enforces its grant (nothing widened)', () => {
    const src = codeOf(LEAVE_POST)
    assert.match(src, /requireCan\(/)
    assert.match(src, /leave_requests/)
  })
})
