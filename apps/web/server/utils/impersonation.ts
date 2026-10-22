import type { H3Event } from 'h3'
import type { AuthSession, Grant, ImpersonatedBy, PortalUser } from '@afc/shared'
import { IMPERSONATION_AUDIT_COLLECTION, impersonationExpiry } from '@afc/shared'
import { grantsForRole } from '@afc/shared/role-matrix'
import { DirectusAuthError, directusFetch } from './directus'
import type { PortalScope } from './portal'
import { createItem, throwStoreUnavailable } from './portal'
import { isImpersonationExpired as isClaimExpired, targetRoleOutranksActor } from '@afc/shared'

/**
 * Impersonation enforcement (AFC-684, server-side only).
 *
 * The matrix lives in `@afc/shared/impersonation` as pure predicates; this
 * module does the Directus reads that resolve a target into a scope, writes
 * the audit rows, and computes the intersection of actor and target grants.
 *
 * Fail-closed throughout: a target outside the actor's scope is a 403 with a
 * named code, never a downgrade to an empty view. A missing audit store is a
 * named 503 (`pending_migration_0037`), never a silent start. A bare 500 is
 * never produced here — every Directus failure is mapped.
 */

export interface ResolvedTarget {
  kind: 'user' | 'branch' | 'zone'
  id: string
  /** Effective user the preview session runs as. */
  user: PortalUser
  /** Zone that proved scope membership (null for area-wide user targets). */
  targetZoneId: string | null
  targetIsAreaWide: boolean
}

interface DirectusUserRow {
  id: string
  email: string
  first_name: string | null
  staff_role: PortalUser['staffRole'] | null
  branch: string | null
  branch_ids: string[] | null
  department_ids: string[] | null
  person: string | null
  area: string | null
  zone: string | null
  zone_ids: string[] | null
}

interface BranchRow {
  id: string
  zone: string | null
}

/** Narrower of two scopes wins; unknown pairings deny (`none`). */
function intersectScope(a: Grant['scope'], b: Grant['scope']): Grant['scope'] {
  if (a === b) return a
  if (a === 'none' || b === 'none') return 'none'
  const rank: Record<string, number> = {
    all: 5,
    assigned_zones: 4,
    own_zone: 3,
    assigned_branches: 2,
    own_branch: 2,
    own_department: 1,
    assigned_departments: 1,
    public_only: 0,
    allowlisted_fields: 0,
  }
  return (rank[a] ?? 0) <= (rank[b] ?? 0) ? a : b
}

/**
 * Effective grants = intersection(actor grants, target grants), never union.
 * A collection/action the actor cannot do stays denied even when the target
 * could; a collection/action the target cannot do stays denied even when the
 * actor could. Scope narrows to the tighter of the two.
 */
export function intersectGrants(actor: Grant[], target: Grant[]): Grant[] {
  const byKey = new Map(target.map((g) => [`${g.collection}:${g.action}`, g]))
  const out: Grant[] = []
  for (const a of actor) {
    const t = byKey.get(`${a.collection}:${a.action}`)
    if (!t) continue
    out.push({ collection: a.collection, action: a.action, scope: intersectScope(a.scope, t.scope) })
  }
  return out.sort((x, y) =>
    `${x.collection}:${x.action}`.localeCompare(`${y.collection}:${y.action}`),
  )
}

export function actorGrantsFor(user: PortalUser): Grant[] {
  return grantsForRole(user.staffRole)
}

export function targetGrantsFor(user: PortalUser): Grant[] {
  return grantsForRole(user.staffRole)
}

/** Throw 403 when impersonating is not active; throw 401 when signed out. */
export function requireImpersonation(data: {
  impersonatedBy?: ImpersonatedBy
}): ImpersonatedBy {
  if (!data.impersonatedBy) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No impersonation is active',
      data: { code: 'not_impersonating' },
    })
  }
  return data.impersonatedBy
}

/** Expired previews behave as ended: the caller exits rather than continues. */
export function throwIfImpersonationExpired(claim: ImpersonatedBy): void {
  if (isClaimExpired(claim)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'The impersonation preview expired — start it again',
      data: { code: 'impersonation_expired' },
    })
  }
}

async function readBranchZone(
  event: H3Event,
  token: string,
  branchId: string,
): Promise<string | null> {
  try {
    const row = await directusFetch<{ data: BranchRow }>(event, `/items/branches/${branchId}`, {
      accessToken: token,
      query: { fields: 'id,zone' },
    })
    return row.data.zone
  } catch (cause) {
    if (cause instanceof DirectusAuthError) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That branch was not found in your scope',
        data: { code: 'branch_not_found' },
      })
    }
    throwStoreUnavailable(cause, 'branch_store', '0002')
  }
}

async function readTargetUser(
  event: H3Event,
  token: string,
  targetUserId: string,
): Promise<DirectusUserRow> {
  try {
    const row = await directusFetch<{ data: DirectusUserRow }>(event, `/users/${targetUserId}`, {
      accessToken: token,
      query: {
        fields: [
          'id',
          'email',
          'first_name',
          'staff_role',
          'branch',
          'branch_ids',
          'department_ids',
          'person',
          'area',
          'zone',
          'zone_ids',
        ].join(','),
      },
    })
    return row.data
  } catch (cause) {
    if (cause instanceof DirectusAuthError) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That user was not found in your scope',
        data: { code: 'user_not_found' },
      })
    }
    throwStoreUnavailable(cause, 'user_store', '0002')
  }
}

/**
 * Resolve a start request into the effective preview user. Performs the
 * fail-closed scope check: out-of-scope targets throw a named 403, they are
 * never rendered as an empty view.
 */
export async function resolveImpersonationTarget(
  event: H3Event,
  scope: PortalScope,
  input: { targetUserId?: string; branchId?: string; zoneId?: string },
): Promise<ResolvedTarget> {
  const actor = scope.session.user

  if (input.targetUserId) {
    const target = await readTargetUser(event, scope.token, input.targetUserId)
    // Self-impersonation is pointless and audit noise: refuse it plainly.
    if (target.id === actor.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are already signed in as that user',
        data: { code: 'cannot_impersonate_self' },
      })
    }
    // Outranks gate (AFC-690 R2 fix): a user-target preview keeps the
    // target's staffRole, and getPortalScope derives isArea from it — so
    // without this, an area_admin previewing a super_admin user acts with
    // super grants, and a zone_admin previewing an area_admin user (even a
    // branch-scoped one) flips isArea to true. The scope gate cannot catch
    // either: area actors pass every scope check. Deny strictly-wider roles
    // here, before any scope read. Equal ranks still pass to the scope gate;
    // lower ranks are a downgrade by construction.
    if (targetRoleOutranksActor(actor.staffRole, target.staff_role ?? 'none')) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That user holds a wider role than yours — preview denied',
        data: { code: 'target_role_outranks_actor' },
      })
    }
    const targetBranchIds = [
      ...new Set(
        [target.branch, ...(target.branch_ids ?? [])].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      ),
    ]
    const targetZoneIds = [
      ...new Set(
        [target.zone, ...(target.zone_ids ?? [])].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      ),
    ]
    const targetIsAreaWide =
      (target.staff_role === 'super_admin' || target.staff_role === 'area_admin') &&
      targetBranchIds.length === 0 &&
      targetZoneIds.length === 0
    // A branch-scoped target proves membership through its single zone; an
    // area-wide target has no zone and only an area actor may reach it.
    let targetZoneId: string | null = target.zone ?? targetZoneIds[0] ?? null
    if (!targetZoneId && targetBranchIds.length > 0) {
      targetZoneId = await readBranchZone(event, scope.token, targetBranchIds[0]!)
    }
    assertInScope(scope, targetZoneId, targetIsAreaWide, 'user_out_of_scope')
    return {
      kind: 'user',
      id: target.id,
      user: {
        id: target.id,
        email: target.email,
        firstName: target.first_name,
        staffRole: target.staff_role ?? 'none',
        branchId: target.branch,
        branchIds: targetBranchIds,
        departmentIds: target.department_ids ?? [],
        personId: target.person,
        areaId: target.area,
        zoneId: target.zone,
        zoneIds: targetZoneIds,
      },
      targetZoneId,
      targetIsAreaWide,
    }
  }

  if (input.branchId) {
    const zone = await readBranchZone(event, scope.token, input.branchId)
    assertInScope(scope, zone, false, 'branch_out_of_scope')
    // Scope preview: the actor looks through a branch_admin lens narrowed to
    // this branch. The role downgrade is the escalation guard for scope
    // targets — area grants never survive into a branch preview.
    const previewRole = actor.staffRole === 'super_admin' || actor.staffRole === 'area_admin' || actor.staffRole === 'zone_admin'
      ? ('branch_admin' as const)
      : ('none' as const)
    const user: PortalUser = {
      id: actor.id,
      email: actor.email,
      firstName: actor.firstName,
      staffRole: previewRole,
      branchId: input.branchId,
      branchIds: [input.branchId],
      departmentIds: [],
      personId: actor.personId,
      areaId: null,
      zoneId: zone,
      zoneIds: zone ? [zone] : [],
    }
    return { kind: 'branch', id: input.branchId, user, targetZoneId: zone, targetIsAreaWide: false }
  }

  const zoneId = input.zoneId!
  assertInScope(scope, zoneId, false, 'zone_out_of_scope')
  const previewRole = actor.staffRole === 'super_admin' || actor.staffRole === 'area_admin'
    ? ('zone_admin' as const)
    : actor.staffRole === 'zone_admin'
      ? ('zone_admin' as const)
      : ('none' as const)
  const user: PortalUser = {
    id: actor.id,
    email: actor.email,
    firstName: actor.firstName,
    staffRole: previewRole,
    branchId: null,
    branchIds: [],
    departmentIds: [],
    personId: actor.personId,
    areaId: null,
    zoneId,
    zoneIds: [zoneId],
  }
  return { kind: 'zone', id: zoneId, user, targetZoneId: zoneId, targetIsAreaWide: false }
}

function assertInScope(
  scope: PortalScope,
  targetZoneId: string | null,
  targetIsAreaWide: boolean,
  code: 'user_out_of_scope' | 'branch_out_of_scope' | 'zone_out_of_scope',
): void {
  if (scope.isArea) return
  if (scope.role !== 'zone_admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your role cannot impersonate',
      data: { code: 'impersonation_forbidden' },
    })
  }
  if (targetIsAreaWide || !targetZoneId || !scope.zoneIds.includes(targetZoneId)) {
    const what = code === 'zone_out_of_scope' ? 'zone' : code === 'branch_out_of_scope' ? 'branch' : 'user'
    throw createError({
      statusCode: 403,
      statusMessage: `That ${what} is outside your zone scope`,
      data: { code },
    })
  }
}

/** Every start writes its audit row; a missing store fails the start (503), never silently. */
export async function writeImpersonationAudit(
  event: H3Event,
  scope: PortalScope,
  row: {
    actor: string
    target_user: string | null
    target_branch: string | null
    target_zone: string | null
    action: 'started' | 'stopped'
    reason: string
  },
): Promise<void> {
  try {
    await createItem(event, scope, IMPERSONATION_AUDIT_COLLECTION, row)
  } catch (error) {
    if (error instanceof DirectusAuthError) {
      throw createError({
        statusCode: 403,
        statusMessage: 'The impersonation log refused this write — sign in again',
        data: { code: 'impersonation_log_forbidden' },
      })
    }
    throwStoreUnavailable(error, 'impersonation_log', '0037')
  }
}

export function buildImpersonatedSession(
  actorSession: AuthSession,
  effectiveUser: PortalUser,
  claim: Omit<ImpersonatedBy, 'expiresAt'>,
  nowMs = Date.now(),
): { session: AuthSession; claim: ImpersonatedBy } {
  const expiresAt = impersonationExpiry(nowMs, actorSession.expiresAt)
  const full: ImpersonatedBy = { ...claim, expiresAt }
  return {
    session: { user: effectiveUser, issuedAt: new Date(nowMs).toISOString(), expiresAt },
    claim: full,
  }
}
