/**
 * Scoped impersonation — pure contract (AFC-684).
 *
 * Client-safe: no role-matrix import, no Directus access. The server enforces
 * the matrix in `server/utils/impersonation.ts`; this module holds the shapes,
 * the TTL, and the pure predicates the contract suite pins.
 *
 * Matrix (fail-closed, never downgraded to empty):
 * - `super_admin` / `area_admin` may target anyone / any branch / any zone.
 * - `zone_admin` may target branches (and branch-scoped users) under its own
 *   `zoneIds` only. Zone-out-of-scope is a 403, never an empty view.
 * - `branch_admin` / `department_leader` / `volunteer` / `none`: no
 *   impersonation target is allowed.
 *
 * No privilege escalation: the effective grants are the intersection of the
 * actor's grants and the target scope, never the union. Branch/zone targets
 * additionally downgrade the preview role (branch → `branch_admin`,
 * zone → `zone_admin`) so an area preview cannot write with area grants.
 */

import { z } from 'zod'

/** Short TTL: an impersonated session lives 30 minutes at most. */
export const IMPERSONATION_TTL_MINUTES = 30
export const IMPERSONATION_TTL_MS = IMPERSONATION_TTL_MINUTES * 60 * 1000

/** Reason is required so the audit row explains itself. */
export const IMPERSONATION_REASON_MIN_LENGTH = 8
export const IMPERSONATION_REASON_MAX_LENGTH = 500

export const impersonationTargetKinds = ['user', 'branch', 'zone'] as const
export type ImpersonationTargetKind = (typeof impersonationTargetKinds)[number]

export const impersonationRequestSchema = z
  .object({
    targetUserId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    reason: z
      .string()
      .trim()
      .min(
        IMPERSONATION_REASON_MIN_LENGTH,
        `Say why in at least ${IMPERSONATION_REASON_MIN_LENGTH} characters`,
      )
      .max(IMPERSONATION_REASON_MAX_LENGTH, 'Keep the reason to 500 characters'),
  })
  .refine(
    (value) =>
      [value.targetUserId, value.branchId, value.zoneId].filter(Boolean).length === 1,
    { message: 'Name exactly one target: targetUserId, branchId, or zoneId', path: ['targetUserId'] },
  )

export type ImpersonationRequest = z.infer<typeof impersonationRequestSchema>

/**
 * Distinct cookie claim carried beside the session: who started the preview,
 * why, when, and the hard expiry. The effective (impersonated) user lives in
 * `AuthSession.user`; the original actor lives here and is never overwritten.
 */
export interface ImpersonatedBy {
  actorId: string
  actorEmail: string
  actorRole: string
  targetKind: ImpersonationTargetKind
  targetId: string
  reason: string
  startedAt: string
  expiresAt: string
  /** The outer session expiry the preview may never run past. */
  originalExpiresAt: string
}

export const impersonatedBySchema: z.ZodType<ImpersonatedBy> = z.object({
  actorId: z.string().uuid(),
  actorEmail: z.string().email(),
  actorRole: z.string(),
  targetKind: z.enum(impersonationTargetKinds),
  targetId: z.string().uuid(),
  reason: z.string().min(1).max(IMPERSONATION_REASON_MAX_LENGTH),
  startedAt: z.string(),
  expiresAt: z.string(),
  originalExpiresAt: z.string(),
})

export type ImpersonatorRole = 'super_admin' | 'area_admin' | 'zone_admin'

const IMERSONATION_ACTORS: ReadonlySet<string> = new Set([
  'super_admin',
  'area_admin',
  'zone_admin',
])

/** Roles that may start an impersonation at all. Fail-closed: anything else is denied. */
export function canInitiateImpersonation(role: string): role is ImpersonatorRole {
  return IMERSONATION_ACTORS.has(role)
}

/**
 * Scope gate for a resolved target. `targetZoneId` is:
 * - for a zone target: the zone itself,
 * - for a branch target: the branch's zone,
 * - for a user target: the target user's single zone when the target is
 *   branch-scoped (branchId set, no area grant), else null for area-wide users.
 *
 * Area actors (`isArea`) may target anything. Zone actors may target only rows
 * whose zone sits in their own `zoneIds`. Branch/department/volunteer actors
 * may target nothing. A target outside the actor's scope is denied (the route
 * turns this into a 403, never an empty view).
 */
export function isTargetInActorScope(input: {
  actorRole: string
  actorIsArea: boolean
  actorZoneIds: string[]
  targetZoneId: string | null
  targetIsAreaWide: boolean
}): boolean {
  if (!canInitiateImpersonation(input.actorRole)) return false
  if (input.actorIsArea) return true
  // Zone actors never reach area-wide users or zoneless rows: without a zone
  // on the target there is nothing to prove membership of.
  if (input.targetIsAreaWide) return false
  if (!input.targetZoneId) return false
  return input.actorZoneIds.includes(input.targetZoneId)
}

/**
 * Preview-role downgrade for scope targets (no user row to borrow a role
 * from). An area preview of a branch renders with branch_admin grants, a zone
 * preview with zone_admin grants — never with the actor's wider grants.
 */
export function previewRoleForScopeTarget(
  targetKind: ImpersonationTargetKind,
): 'branch_admin' | 'zone_admin' {
  return targetKind === 'zone' ? 'zone_admin' : 'branch_admin'
}

/**
 * Role hierarchy for the user-target outranks gate (AFC-690 R2 fix).
 *
 * A user-target preview keeps the target's `staffRole`, and `getPortalScope`
 * derives `isArea` from that role — so an area_admin previewing a
 * super_admin user would act with super grants for 30 minutes, and a
 * zone_admin previewing an area_admin user (even a branch-scoped one) would
 * flip `isArea` to true. The scope gate alone cannot catch it: an area actor
 * passes every scope check, and a branch-scoped area user passes the zone
 * check. Fail closed one level earlier: a target whose role strictly
 * outranks the actor's is denied with `target_role_outranks_actor`, never
 * rendered. Equal ranks are allowed (the scope gate still narrows them);
 * anything below the actor is a downgrade by construction. Unknown roles
 * rank 0, so an unrecognised target role is a downgrade, never an escape.
 */
const IMPERSONATION_ROLE_RANK: Readonly<Record<string, number>> = {
  super_admin: 3,
  area_admin: 2,
  zone_admin: 1,
  branch_admin: 0,
  department_leader: 0,
  volunteer: 0,
  none: 0,
}

export function targetRoleOutranksActor(actorRole: string, targetRole: string): boolean {
  return (IMPERSONATION_ROLE_RANK[targetRole] ?? 0) > (IMPERSONATION_ROLE_RANK[actorRole] ?? 0)
}

/** Impersonated expiry: 30 minutes from now, capped by the outer session. */
export function impersonationExpiry(nowMs: number, originalExpiresAt: string): string {
  const capped = new Date(originalExpiresAt).getTime()
  const ttl = nowMs + IMPERSONATION_TTL_MS
  const expires = Number.isNaN(capped) ? ttl : Math.min(ttl, capped)
  return new Date(expires).toISOString()
}

export function isImpersonationExpired(claim: { expiresAt: string }, nowMs = Date.now()): boolean {
  return new Date(claim.expiresAt).getTime() <= nowMs
}

/** Audit store owned by migration 0037. */
export const IMPERSONATION_AUDIT_COLLECTION = 'impersonation_events'

export interface ImpersonationAuditRow {
  actor: string
  target_user: string | null
  target_branch: string | null
  target_zone: string | null
  action: 'started' | 'stopped'
  reason: string
  started_at?: string
}
