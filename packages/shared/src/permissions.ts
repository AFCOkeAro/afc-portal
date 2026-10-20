/**
 * Capability model.
 *
 * The browser is not told a role. It is told what it may do. That indirection is
 * required, not stylistic:
 *
 *   - data-model §9: "the server-side Directus policy is the only authoritative
 *     control". Anything the client decides is navigation and field visibility,
 *     defence in depth, and nothing more.
 *   - data-model §13 rule 7: "do not hard-code Directus role names in the UI;
 *     drive navigation from a capabilities endpoint (/api/me/permissions) that
 *     both platforms can implement".
 *
 * So this module holds the wire shape and the pure predicates over it. The role
 * to capability translation lives beside it in `role-matrix.ts` and is imported
 * server-side only.
 */
import type { CollectionName } from './collections'

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete'] as const

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

/**
 * Record scope a grant applies to. Named for what it means, not for the filter
 * syntax, so the same string survives a change of governance layer.
 */
export const PERMISSION_SCOPES = [
  /** Every record. Area admins and super admins. */
  'all',
  /** Records on the user's own branch. */
  'own_branch',
  /** Records on any branch in `branchIds`. */
  'assigned_branches',
  /** Records in the user's own zone (`zone` = user zone). */
  'own_zone',
  /** Records in any zone in `zoneIds`. */
  'assigned_zones',
  /** Records scoped to the user's own department. */
  'own_department',
  /** Only events/visitors/cases tagged for the user's departments. */
  'assigned_departments',
  /** Only rows where the record itself is public. */
  'public_only',
  /** Create only, against an allowlisted field set. */
  'allowlisted_fields',
  /** Nothing. */
  'none',
] as const

export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

/** A single grant: one action on one collection, at one scope. */
export interface Grant {
  collection: CollectionName
  action: PermissionAction
  scope: PermissionScope
  /**
   * The parenthetical qualifier from data-model §10, kept verbatim so the
   * translation from the document to code is auditable in both directions.
   * It is documentation, not enforcement.
   */
  note?: string
}

export type Capability = `${CollectionName}:${PermissionAction}`

export interface CapabilitiesPayload {
  /** Every grant the session holds. Sorted, so the payload is diffable. */
  grants: Grant[]
  /** Collections the UI may read, derived from the grants. */
  readable: CollectionName[]
  /** Collections the UI may write. */
  writable: CollectionName[]
  /**
   * Fields the session must not be offered, keyed by collection. The frontend
   * hides these (data-model §10.1); the Directus policy `fields` list is what
   * actually withholds them.
   */
  hiddenFields: Record<string, string[]>
  /**
   * False when the session has no branch and is not an area/super admin. This is
   * the fail-closed case from data-model §9 rule 5: such a user sees nothing.
   */
  scoped: boolean
}

export function capabilityKey(
  collection: CollectionName,
  action: PermissionAction,
): Capability {
  return `${collection}:${action}`
}

export function grantsToCapabilities(grants: readonly Grant[]): Capability[] {
  return grants.map((grant) => capabilityKey(grant.collection, grant.action))
}

/**
 * Pure predicate over a grants list. Used server-side to build the payload and
 * in the browser by `usePermissions` for navigation and field visibility.
 */
export function hasCapability(
  grants: readonly Grant[],
  collection: CollectionName,
  action: PermissionAction,
): boolean {
  return grants.some(
    (grant) => grant.collection === collection && grant.action === action,
  )
}

export function grantFor(
  grants: readonly Grant[],
  collection: CollectionName,
  action: PermissionAction,
): Grant | undefined {
  return grants.find(
    (grant) => grant.collection === collection && grant.action === action,
  )
}

export function scopeOf(
  grants: readonly Grant[],
  collection: CollectionName,
  action: PermissionAction,
): PermissionScope {
  return grantFor(grants, collection, action)?.scope ?? 'none'
}

export function readableCollections(grants: readonly Grant[]): CollectionName[] {
  return [
    ...new Set(grants.filter((g) => g.action === 'read').map((g) => g.collection)),
  ].sort()
}

export function writableCollections(grants: readonly Grant[]): CollectionName[] {
  const writable = grants
    .filter((g) => g.action === 'create' || g.action === 'update')
    .map((g) => g.collection)
  return [...new Set(writable)].sort()
}

/**
 * Sort a grants list into a stable order so two responses for the same session
 * compare equal. A capabilities payload that reshuffles on every request makes
 * a cache useless and a diff meaningless.
 */
export function sortGrants(grants: readonly Grant[]): Grant[] {
  return [...grants].sort((a, b) => {
    const byCollection = a.collection.localeCompare(b.collection)
    if (byCollection !== 0) return byCollection
    const order = PERMISSION_ACTIONS.indexOf(a.action)
    const other = PERMISSION_ACTIONS.indexOf(b.action)
    return order - other
  })
}
