/**
 * AFC-836 contract — super-admin role matrix editing with overrides.
 *
 * Built-in roles stay governed by role-matrix.ts in code; a super admin
 * may grant/revoke individual collection:action cells. Grants/revokes are
 * recorded in role_grant_overrides and mirrored to Directus policies, so
 * the portal gate and the Directus policy never disagree. Deny wins.
 *
 * Run: node --test tests/web/role-overrides.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261028_0049_role_grant_overrides.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0049_role_grant_overrides.down.sql'
const SUITE = 'tests/db/49_role_grant_overrides.sql'
const CUSTOM = 'apps/web/server/utils/custom-grants.ts'
const GUARD = 'apps/web/server/utils/admin-guard.ts'
const PORTAL = 'apps/web/server/utils/portal.ts'
const ME = 'apps/web/server/api/me/permissions.get.ts'
const GET = 'apps/web/server/api/admin/roles/[id]/permissions.get.ts'
const POST = 'apps/web/server/api/admin/roles/[id]/permissions.post.ts'
const REVOKE = 'apps/web/server/api/admin/roles/[id]/revocations.post.ts'
const UI = 'apps/web/pages/admin/roles.vue'

describe('AFC-836 override register', () => {
  it('creates the delta table with a per-triple uniqueness guard', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS role_grant_overrides/)
    assert.match(
      src,
      /UNIQUE \(role_key, collection, action\)/,
      'one row per triple names the direction',
    )
  })

  it('grants least privilege and revokes PUBLIC', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON role_grant_overrides TO directus_app/)
    assert.match(src, /GRANT INSERT \(role_key, collection, action, effect, created_by\)/)
    assert.match(src, /GRANT DELETE ON role_grant_overrides TO directus_app/)
    assert.doesNotMatch(src, /UPDATE ON role_grant_overrides/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = codeOf(DOWN)
    assert.match(src, /refusing to roll back role_grant_overrides/)
    assert.match(src, /DROP TABLE IF EXISTS role_grant_overrides/)
  })
})

describe('AFC-836 deny-wins enforcement', () => {
  it('can() consults overrides before the matrix', () => {
    const src = codeOf(PORTAL)
    assert.match(src, /override\?.effect === 'revoke'[^]*return false/)
    assert.match(src, /return override\?.effect === 'grant'/)
  })

  it('the capabilities endpoint applies overrides', () => {
    const src = codeOf(ME)
    assert.match(src, /applyOverrides\(payload\.grants/)
    assert.match(src, /applyOverrides\(custom/)
  })

  it('a super-admin gate exists and is used for built-in writes', () => {
    const src = codeOf(GUARD)
    assert.match(src, /requireSuperAdmin/)
    assert.match(src, /super_admin/)
    assert.match(codeOf(REVOKE), /requireSuperAdmin/)
    assert.match(codeOf(POST), /requireSuperAdmin/)
  })

  it('the GET endpoint reports effective grants with their source', () => {
    const src = codeOf(GET)
    assert.match(src, /sources/)
    assert.match(src, /granted/)
    assert.match(src, /matrix/)
    assert.match(src, /revoke/)
  })

  it('revoke snapshots Directus rows before deleting (parity both ways)', () => {
    const src = codeOf(REVOKE)
    assert.match(src, /storedDirectusGrants/)
    assert.match(src, /method: 'DELETE'/)
    assert.match(src, /writeOverride[\s\S]{0,60}revoke/s)
  })

  it('grant honours a prior revoke by restoring first', () => {
    const src = codeOf(POST)
    assert.match(src, /effect === 'revoke'/)
    assert.match(src, /clearOverride/)
  })
})

describe('AFC-836 UI gating', () => {
  it('built-in toggles need the actor to be super admin', () => {
    const src = codeOf(UI)
    assert.match(src, /isSuperAdmin/)
    assert.match(src, /revocations/)
    assert.match(src, /canEditRole/)
  })

  it('the matrix shows checks for effective grants, dashes otherwise', () => {
    const src = codeOf(UI)
    assert.match(src, /isGranted\(collection, action\)/)
    assert.match(src, /i-lucide-check/)
  })
})
