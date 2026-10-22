import { getPortalScope } from '../../utils/portal'
import { readSession, writeSession } from '../../utils/session'
import { requireImpersonation, writeImpersonationAudit } from '../../utils/impersonation'

/**
 * POST /api/admin/impersonate-exit — one-click exit from a preview (AFC-684).
 *
 * Restores the actor's session with its original expiry (a preview never
 * extends the outer session) and writes the `stopped` audit row. Ending is
 * always allowed for the actor that started it — even after the preview TTL
 * passed, so an expired banner can always be dismissed.
 */
export default defineEventHandler(async (event) => {
  const data = await readSession(event)
  if (!data) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Sign in to continue',
      data: { code: 'unauthenticated' },
    })
  }
  const claim = requireImpersonation(data)

  // The audit is written with the actor's scope, not the preview scope: the
  // preview user may have narrower grants than the actor.
  const actorSession = {
    user: {
      id: claim.actorId,
      email: claim.actorEmail,
      firstName: null,
      staffRole: claim.actorRole as 'super_admin' | 'area_admin' | 'zone_admin',
      branchId: null,
      branchIds: [] as string[],
      departmentIds: [] as string[],
      personId: null,
    },
    issuedAt: new Date().toISOString(),
    expiresAt: claim.originalExpiresAt,
  }
  // Re-resolve the actor scope for the audit write; the sealed preview
  // session alone is not trusted for the actor's branches/zones.
  const scope = await getPortalScope(event).catch(() => null)
  const auditScope =
    scope ??
    ({
      session: { user: actorSession.user, issuedAt: actorSession.issuedAt, expiresAt: actorSession.expiresAt },
      role: actorSession.user.staffRole,
      isArea: true,
      branchIds: [],
      areaId: null,
      zoneIds: [],
      hiddenFields: {},
      token: '',
    } as never)

  try {
    await writeImpersonationAudit(event, auditScope, {
      actor: claim.actorId,
      target_user: claim.targetKind === 'user' ? claim.targetId : null,
      target_branch: claim.targetKind === 'branch' ? claim.targetId : null,
      target_zone: claim.targetKind === 'zone' ? claim.targetId : null,
      action: 'stopped',
      reason: claim.reason,
    })
  } catch (error) {
    // An audit failure on exit must not trap the user inside the preview:
    // log loudly and still restore the actor session. The start path stays
    // fail-closed; the exit path stays escapable.
    console.error('impersonation exit audit write failed', error)
  }

  await writeSession(event, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    session: {
      user: {
        ...actorSession.user,
        // Keep the actor's live branch/zone grants when they are known: the
        // claim only carries identity, not scope. Where the scope is unknown
        // (scope resolution failed above) the next getPortalScope fail-closes.
        branchId: (scope?.session.user.branchId ?? null) as string | null,
        branchIds: scope?.session.user.branchIds ?? [],
        departmentIds: scope?.session.user.departmentIds ?? [],
        personId: scope?.session.user.personId ?? null,
        areaId: scope?.session.user.areaId ?? null,
        zoneId: scope?.session.user.zoneId ?? null,
        zoneIds: scope?.session.user.zoneIds ?? [],
      },
      issuedAt: actorSession.issuedAt,
      expiresAt: claim.originalExpiresAt,
    },
  })

  return { exited: true }
})
