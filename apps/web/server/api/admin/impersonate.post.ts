import { impersonationRequestSchema, isTargetInActorScope } from '@afc/shared'
import { throwValidation } from '../../utils/portal'
import { getPortalScope } from '../../utils/portal'
import { readSession, writeSession } from '../../utils/session'
import {
  buildImpersonatedSession,
  resolveImpersonationTarget,
  writeImpersonationAudit,
} from '../../utils/impersonation'

/**
 * POST /api/admin/impersonate — start a time-boxed impersonated preview (AFC-684).
 *
 * Body: `{ targetUserId | branchId | zoneId, reason }` — exactly one target,
 * reason required (≥8 chars) so the audit row explains itself.
 *
 * Matrix (fail-closed, never downgraded to empty):
 * - super_admin / area_admin may target anyone / any branch / zone in scope.
 * - zone_admin may target branches (and branch-scoped users) under its own
 *   zoneIds only — anything else is a 403 with a named code.
 * - branch_admin / department_leader / volunteer / none: 403 always.
 *
 * No escalation: scope targets run with a downgraded preview role
 * (branch → branch_admin, zone → zone_admin); user targets keep the target's
 * role but the permissions endpoint intersects actor × target grants. The
 * preview expires after 30 minutes and never past the outer session.
 *
 * Every start writes an `impersonation_events` row. A missing audit store
 * fails the start with a named 503 — it never starts silently.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const actor = scope.session.user

  const parsed = impersonationRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throwValidation(parsed.error)
  }
  const body = parsed.data

  if (scope.session.expiresAt && new Date(scope.session.expiresAt).getTime() <= Date.now()) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Sign in again to continue',
      data: { code: 'session_expired' },
    })
  }

  const current = await readSession(event)
  if (current?.impersonatedBy) {
    throw createError({
      statusCode: 409,
      statusMessage: 'End the current preview before starting another',
      data: { code: 'already_impersonating' },
    })
  }

  // Fast role gate before any store read: branch/department/volunteer/none
  // never reach target resolution.
  if (
    actor.staffRole !== 'super_admin' &&
    actor.staffRole !== 'area_admin' &&
    actor.staffRole !== 'zone_admin'
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your role cannot impersonate',
      data: { code: 'impersonation_forbidden' },
    })
  }

  const resolved = await resolveImpersonationTarget(event, scope, body)

  // Belt-and-braces on the pure predicate: resolution already enforced scope,
  // but a scope that cannot be enumerated must still never render.
  const allowed = isTargetInActorScope({
    actorRole: actor.staffRole,
    actorIsArea: scope.isArea,
    actorZoneIds: scope.zoneIds,
    targetZoneId: resolved.targetZoneId,
    targetIsAreaWide: resolved.targetIsAreaWide,
  })
  if (!allowed) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That target is outside your scope',
      data: { code: 'target_out_of_scope' },
    })
  }

  const targetKind = resolved.kind
  await writeImpersonationAudit(event, scope, {
    actor: actor.id,
    target_user: targetKind === 'user' ? resolved.id : null,
    target_branch: targetKind === 'branch' ? resolved.id : null,
    target_zone: targetKind === 'zone' ? resolved.id : null,
    action: 'started',
    reason: body.reason,
  })

  const nowMs = Date.now()
  const { session, claim } = buildImpersonatedSession(
    scope.session,
    resolved.user,
    {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.staffRole,
      targetKind,
      targetId: resolved.id,
      reason: body.reason,
      startedAt: new Date(nowMs).toISOString(),
      originalExpiresAt: scope.session.expiresAt,
    },
    nowMs,
  )

  await writeSession(event, {
    accessToken: current?.accessToken ?? scope.token,
    refreshToken: current?.refreshToken ?? null,
    session,
    impersonatedBy: claim,
  })

  return { session, impersonatedBy: claim }
})
