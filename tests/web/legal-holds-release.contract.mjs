/**
 * AFC-243 contract tests — audited legal-hold release path.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * release path is built on:
 *   1. Route: resolves the session, gates on the legal_holds update grant,
 *      passes the SESSION user's id (never caller input), and ignores the
 *      request body entirely.
 *   2. Util: reaches retention.release_hold_as over the dedicated service
 *      credential with a parameterised call; maps "no active hold" to 404.
 *   3. Matrix: legal_holds update is held by exactly super_admin +
 *      area_admin (the DPO seats), nothing else.
 *   4. Engine: the function is granted only to legal_hold_releaser, revoked
 *      from directus_app, and refuses any other session_user with 42501.
 *   5. Bootstrap: legal_hold_releaser is a LOGIN role with CONNECTION LIMIT 1.
 *   6. The permission gate is load-bearing: the assertion names the exact
 *      requireCan call, so deleting the gate fails the suite (acceptance:
 *      "a test that fails if the release path exists without a permission
 *      in front of it").
 *
 * Run: node --test tests/web/legal-holds-release.contract.mjs
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

const ROUTE = 'apps/web/server/api/legal-holds/[id]/release.post.ts'
const UTIL = 'apps/web/server/utils/legal-holds.ts'
const ENGINE = 'services/directus/schema/engine/0001_retention_engine.sql'
const BOOTSTRAP = 'services/directus/schema/bootstrap/0001_roles.sql'
const MATRIX = 'packages/shared/src/role-matrix.ts'
const NUXT_CONFIG = 'apps/web/nuxt.config.ts'

describe('AFC-243 release route: authenticated user in, permission in front', () => {
  it('resolves the portal scope (401 with no session) before anything else', () => {
    const code = codeOf(ROUTE)
    assert.match(
      code,
      /getPortalScope\s*\(\s*event\s*\)/,
      'route resolves the session first',
    )
  })

  it('gates on the legal_holds update grant (the permission in front)', () => {
    const code = codeOf(ROUTE)
    assert.match(
      code,
      /requireCan\s*\(\s*scope\s*,\s*['"]legal_holds['"]\s*,\s*['"]update['"]\s*\)/,
      'route requires the legal_holds update grant: deleting this line must fail this test',
    )
  })

  it('passes the session user as the releaser, never caller input', () => {
    const code = codeOf(ROUTE)
    assert.match(code, /scope\.session\.user\.id/, 'releaser comes from the session')
    assert.doesNotMatch(
      code,
      /readBody/,
      'route never reads the request body: no caller-supplied releaser',
    )
    assert.doesNotMatch(
      code,
      /released_by/,
      'route never names a releaser column: the database stamps it',
    )
  })

  it('delegates to the service util with (event, hold, releaser)', () => {
    const code = codeOf(ROUTE)
    assert.match(
      code,
      /releaseLegalHoldAs\s*\(\s*event\s*,\s*id\s*,\s*releaser\s*\)/,
      'route calls the service util with the path hold id and the session user',
    )
  })
})

describe('AFC-243 service util: dedicated credential, parameterised call', () => {
  it('connects from server runtime config, never a pooled app credential', () => {
    const code = codeOf(UTIL)
    assert.match(
      code,
      /legalHoldDatabaseUrl/,
      'credential comes from server runtime config',
    )
    assert.doesNotMatch(
      code,
      /directusServerToken/,
      'util never uses the pooled application token',
    )
  })

  it('calls release_hold_as parameterised, never interpolated', () => {
    const code = codeOf(UTIL)
    assert.match(
      code,
      /retention\.release_hold_as\(\$1::uuid,\s*\$2::uuid\)/,
      'parameterised call with two uuid slots',
    )
    assert.doesNotMatch(
      code,
      /\$\{holdId\}|\$\{releaserId\}/,
      'no interpolation of identities into SQL',
    )
  })

  it('maps no-active-hold to 404 and keeps misconfiguration loud', () => {
    const code = codeOf(UTIL)
    assert.match(code, /invalid_parameter_value/, 'function refusal is distinguished')
    assert.match(code, /hold_not_active/, 'unknown or already-released hold answers 404')
    assert.match(
      code,
      /legal_hold_not_configured/,
      'absent credential answers 503, not 500',
    )
  })
})

describe('AFC-243 matrix: exactly the DPO seats release', () => {
  it('grants legal_holds update to super_admin and area_admin only', () => {
    const code = codeOf(MATRIX)
    const start = code.indexOf('[COLLECTIONS.legalHolds]')
    assert.ok(start !== -1, 'matrix names the legal_holds collection')
    const block = code.slice(start, code.indexOf('},', start))
    assert.match(block, /super_admin:\s*\[\s*U/, 'super_admin holds update')
    assert.match(block, /area_admin:\s*\[\s*U/, 'area_admin holds update')
    for (const role of [
      'branch_admin',
      'department_leader',
      'volunteer',
      'none',
      'zone_admin',
    ]) {
      assert.match(
        block,
        new RegExp(`${role}:\\s*\\[\\s*NONE`),
        `${role} holds nothing on legal_holds`,
      )
    }
  })
})

describe('AFC-243 engine: granted once, to the service role only', () => {
  it('grants release_hold_as to legal_hold_releaser in the same change as the caller', () => {
    const code = codeOf(ENGINE)
    assert.match(
      code,
      /GRANT EXECUTE ON FUNCTION retention\.release_hold_as\(uuid,\s*uuid\) TO legal_hold_releaser/,
      'grant arrives with the caller',
    )
  })

  it('keeps directus_app away from the new function twice over', () => {
    const code = codeOf(ENGINE)
    assert.match(
      code,
      /REVOKE EXECUTE ON FUNCTION retention\.release_hold_as\(uuid,\s*uuid\) FROM directus_app/,
      'application role is explicitly revoked',
    )
    assert.match(
      code,
      /session_user\s*<>\s*['"]legal_hold_releaser['"]/,
      'any other session is refused inside the function too',
    )
  })

  it('leaves the 64.1b empty-surface pin intact', () => {
    const suite64 = read('tests/db/64_retention_worker_surface.sql')
    assert.match(
      suite64,
      /directus_app EXECUTE surface on the engine is empty/,
      '64.1b still pins the application surface to empty with the release path in the catalog',
    )
  })
})

describe('AFC-243 bootstrap: the service identity is a bounded login', () => {
  it('creates legal_hold_releaser as LOGIN and bounds it to one session', () => {
    const code = codeOf(BOOTSTRAP)
    assert.match(code, /legal_hold_releaser.*LOGIN/, 'service identity is a login')
    assert.match(
      code,
      /ALTER ROLE legal_hold_releaser WITH CONNECTION LIMIT 1/,
      'one release path, one session',
    )
  })
})

describe('AFC-243 wiring: server-side credential, never browser-visible', () => {
  it('declares legalHoldDatabaseUrl in server runtime config only', () => {
    const raw = read(NUXT_CONFIG)
    assert.match(
      raw,
      /legalHoldDatabaseUrl/,
      'runtime config names the release credential',
    )
    const publicStart = raw.indexOf('public:')
    const declAt = raw.indexOf('legalHoldDatabaseUrl')
    assert.ok(
      declAt !== -1 && declAt < publicStart,
      'credential lives outside the public (browser-visible) block',
    )
  })
})
