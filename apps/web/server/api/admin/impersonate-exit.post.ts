import { readSession, writeSession } from '../../utils/session'
import {
  readActorPortalUser,
  requireImpersonation,
  writeImpersonationAuditAsServer,
} from '../../utils/impersonation'

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

  // Rehydrate the actor from its live user row (AFC-692): the sealed
  // session at this point is still the narrowed preview, so resolving
  // scope from it would restore a multi-zone actor narrowed to the
  // previewed zone until re-login. The preserved outer access token reads
  // the actor row; any failure falls back to a minimal identity (fail-
  // closed — the next scoped read forces re-login to rehydrate) while the
  // exit itself still succeeds and never traps the user in the preview.
  let actorUser: {
    id: string
    email: string
    firstName: string | null
    staffRole: 'super_admin' | 'area_admin' | 'zone_admin'
    branchId: string | null
    branchIds: string[]
    departmentIds: string[]
    personId: string | null
    areaId?: string | null
    zoneId?: string | null
    zoneIds?: string[]
  } | null = null
  try {
    const live = await readActorPortalUser(event, data.accessToken, claim.actorId)
    actorUser = {
      id: live.id,
      email: live.email,
      firstName: live.firstName,
      staffRole: live.staffRole as 'super_admin' | 'area_admin' | 'zone_admin',
      branchId: live.branchId,
      branchIds: live.branchIds,
      departmentIds: live.departmentIds,
      personId: live.personId,
      areaId: live.areaId ?? null,
      zoneId: live.zoneId ?? null,
      zoneIds: live.zoneIds ?? [],
    }
  } catch (error) {
    console.error(
      'impersonation exit actor re-read failed, restoring minimal identity',
      error,
    )
  }
  const restoredUser = actorUser ?? {
    id: claim.actorId,
    email: claim.actorEmail,
    firstName: null,
    staffRole: claim.actorRole as 'super_admin' | 'area_admin' | 'zone_admin',
    branchId: null,
    branchIds: [] as string[],
    departmentIds: [] as string[],
    personId: null,
    areaId: null,
    zoneId: null,
    zoneIds: [] as string[],
  }
  const issuedAt = new Date().toISOString()

  // The audit is a system write with the explicit server token (AFC-692):
  // there is no trustworthy actor scope at exit time to write with.
  try {
    await writeImpersonationAuditAsServer(event, {
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
      user: restoredUser,
      issuedAt,
      expiresAt: claim.originalExpiresAt,
    },
  })

  return { exited: true }
})
