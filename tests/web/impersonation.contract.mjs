/**
 * AFC-684 contract tests — scoped impersonation (audited, expirable, visible).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Matrix allow/deny incl. zone-out-of-scope 403 (fail-closed, never
 *     downgraded to an empty view).
 *  2. Escalation-impossible: effective grants = intersection(actor, target),
 *     never union; scope targets run with a downgraded preview role.
 *  3. Audit written on every start/stop; list view is area-only.
 *  4. Expiry + exit: short TTL capped by the outer session, expired previews
 *     fail closed, exit restores the actor and stays escapable.
 *  5. Failure shape: named codes everywhere, never a bare 500.
 *  6. UI: admin-only picker uses searchable EntitySelect only, reason
 *     required, persistent banner with one-click exit; scoped views render
 *     read-only where the actor lacks write (intersection in permissions).
 *
 * Run: node --test tests/web/impersonation.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('AFC-684 matrix: allow/deny, fail-closed', () => {
  it('shared matrix names exactly the three initiating roles', () => {
    const src = codeOf('packages/shared/src/impersonation.ts')
    assert.match(src, /super_admin/)
    assert.match(src, /area_admin/)
    assert.match(src, /zone_admin/)
    assert.match(src, /canInitiateImpersonation/)
  })

  it('branch/department/volunteer/none cannot initiate (fail-closed)', () => {
    const src = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(src, /impersonation_forbidden/)
  })

  it('zone-out-of-scope targets are a named 403, never an empty view', () => {
    const src = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(src, /user_out_of_scope/)
    assert.match(src, /branch_out_of_scope/)
    assert.match(src, /zone_out_of_scope/)
    assert.match(src, /statusCode:\s*403/)
    assert.doesNotMatch(src, /return \[\]/)
  })

  it('start route re-checks the pure scope predicate (belt and braces)', () => {
    const src = codeOf('apps/web/server/api/admin/impersonate.post.ts')
    assert.match(src, /isTargetInActorScope/)
    assert.match(src, /target_out_of_scope/)
    assert.match(src, /statusCode:\s*403/)
  })

  it('self-impersonation is refused, double-start is a 409', () => {
    const util = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(util, /cannot_impersonate_self/)
    const route = codeOf('apps/web/server/api/admin/impersonate.post.ts')
    assert.match(route, /already_impersonating/)
  })
})

describe('AFC-684 escalation-impossible: intersection, never union', () => {
  it('effective grants intersect actor and target with narrower scope winning', () => {
    const src = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(src, /intersectGrants/)
    assert.match(src, /intersectScope/)
  })

  it('scope targets run with a downgraded preview role', () => {
    const src = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(src, /previewRoleForScopeTarget|previewRole/)
    assert.match(src, /branch_admin/)
    assert.match(src, /zone_admin/)
  })

  it('user targets cannot outrank the actor (area->super and zone->area/super denied)', () => {
    const shared = codeOf('packages/shared/src/impersonation.ts')
    assert.match(shared, /targetRoleOutranksActor/)
    assert.match(shared, /super_admin/)
    const src = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(src, /targetRoleOutranksActor/)
    assert.match(src, /target_role_outranks_actor/)
    assert.match(src, /statusCode:\s*403/)
  })

  it('permissions endpoint intersects while impersonating (read-only where the actor lacks write)', () => {
    const src = codeOf('apps/web/server/api/me/permissions.get.ts')
    assert.match(src, /impersonatedBy/)
    assert.match(src, /intersectGrants/)
  })
})

describe('AFC-684 audit: every start/stop, area-only list', () => {
  it('start writes the started row; a missing store fails the start (503, never silent)', () => {
    const start = codeOf('apps/web/server/api/admin/impersonate.post.ts')
    assert.match(start, /writeImpersonationAudit/)
    assert.match(start, /'started'/)
    const util = codeOf('apps/web/server/utils/impersonation.ts')
    assert.match(util, /IMPERSONATION_AUDIT_COLLECTION/)
    assert.match(util, /throwStoreUnavailable/)
    assert.match(util, /impersonation_log/)
    assert.match(util, /0037/)
    const shared = codeOf('packages/shared/src/impersonation.ts')
    assert.match(shared, /impersonation_events/)
  })

  it('exit writes the stopped row and stays escapable when the audit fails', () => {
    const src = codeOf('apps/web/server/api/admin/impersonate-exit.post.ts')
    assert.match(src, /'stopped'/)
    assert.match(src, /catch \(error\)/)
    assert.match(src, /writeSession/)
  })

  it('list view is area-only with named 403/503 (never bare 500, never degraded [])', () => {
    const src = codeOf('apps/web/server/api/admin/impersonations.get.ts')
    assert.match(src, /isArea/)
    assert.match(src, /impersonation_log_forbidden/)
    assert.match(src, /throwStoreUnavailable/)
    assert.doesNotMatch(src, /return \[\]/)
  })

  it('migration 0037 owns the audit store (append-only, CTO approval flagged)', () => {
    const mig = codeOf('services/directus/schema/migrations/20261022_0037_impersonation_events.sql')
    assert.match(mig, /impersonation_events/)
    assert.match(mig, /single_target/)
    assert.match(mig, /NO UPDATE/)
    assert.match(mig, /NO DELETE/)
    assert.match(mig, /CTO APPROVAL REQUIRED/)
  })
})

describe('AFC-684 expiry + exit: short TTL, capped, fail-closed', () => {
  it('TTL is 30 minutes and capped by the outer session', () => {
    const src = codeOf('packages/shared/src/impersonation.ts')
    assert.match(src, /IMPERSONATION_TTL_MINUTES\s*=\s*30/)
    assert.match(src, /originalExpiresAt/)
  })

  it('scoped reads reject expired previews with a named 401', () => {
    const src = codeOf('apps/web/server/utils/portal.ts')
    assert.match(src, /impersonatedBy/)
    assert.match(src, /impersonation_expired/)
  })

  it('exit restores the actor session with its original expiry', () => {
    const src = codeOf('apps/web/server/api/admin/impersonate-exit.post.ts')
    assert.match(src, /originalExpiresAt/)
  })

  it('session carries the distinct impersonatedBy claim with the actor retained', () => {
    const src = codeOf('apps/web/server/utils/session.ts')
    assert.match(src, /impersonatedBy/)
    const me = codeOf('apps/web/server/api/auth/me.get.ts')
    assert.match(me, /impersonatedBy/)
  })
})

describe('AFC-684 failure shape: named codes, never a bare 500', () => {
  it('no bare 500 in the impersonation routes', () => {
    for (const rel of [
      'apps/web/server/api/admin/impersonate.post.ts',
      'apps/web/server/api/admin/impersonate-exit.post.ts',
      'apps/web/server/api/admin/impersonations.get.ts',
      'apps/web/server/utils/impersonation.ts',
    ]) {
      const src = codeOf(rel)
      assert.doesNotMatch(src, /statusCode:\s*500/, `${rel} must not produce a bare 500`)
    }
  })

  it('reason is required (audit explains itself)', () => {
    const shared = codeOf('packages/shared/src/impersonation.ts')
    assert.match(shared, /REASON_MIN_LENGTH/)
    const route = codeOf('apps/web/server/api/admin/impersonate.post.ts')
    assert.match(route, /impersonationRequestSchema/)
  })
})

describe('AFC-684 UI: picker, banner, exit', () => {
  it('picker uses the searchable EntitySelect (user UUID is the documented no-endpoint exception)', () => {
    const src = codeOf('apps/web/pages/admin/impersonate.vue')
    assert.match(src, /EntitySelect/)
    assert.match(src, /no list endpoint|no user list endpoint/i)
  })

  it('picker requires a target and a reason', () => {
    const src = codeOf('apps/web/pages/admin/impersonate.vue')
    assert.match(src, /reason/)
    assert.match(src, /Choose a target/)
  })

  it('banner marks every preview with actor, target, reason, expiry + exit', () => {
    const src = codeOf('apps/web/components/ImpersonationBanner.vue')
    assert.match(src, /role="status"/)
    assert.match(src, /Exit preview/)
    assert.match(src, /impersonate-exit/)
  })

  it('banner renders in the staff shell', () => {
    const src = codeOf('apps/web/layouts/default.vue')
    assert.match(src, /ImpersonationBanner/)
  })
})
