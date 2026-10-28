import { STAFF_ROLES } from '@afc/shared'
import type { CollectionName, Grant, PermissionAction } from '@afc/shared'
import { directusFetch } from './directus'
import { directusAdminToken, forgetDirectusAdminToken } from './directus-admin'

/**
 * Custom-role grant resolution (AFC-669).
 *
 * Built-in staff roles resolve through the code matrix (`grantsForRole`);
 * anything else in `directus_users.staff_role` is a custom role whose grants
 * live in Directus: role -> access -> policy -> permissions. This loader
 * translates those Directus permissions back into portal grants so custom
 * roles are enforced by the same `requireCan` gate as built-ins, and so
 * `/api/me/permissions` (sidebar gating) sees them too.
 *
 * Row scoping is unchanged: grants only open the collection+action, while
 * `scopeFilter`/`officeBranchScope` narrow rows to the session's own
 * branch/zone/area links. A custom role on a zone-linked user therefore
 * sees exactly that zone's rows — the zone-bundle example.
 *
 * Reads run as the Directus administrator (custom-role holders cannot read
 * the role tables with their own tokens). Fail-closed throughout: unknown
 * roles, missing links and Directus errors all resolve to zero grants.
 * Results are cached per role name for 60s.
 */
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; grants: Grant[] }>()

export function isBuiltInRole(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

/**
 * Seeded Directus display names for the built-in staff roles. The portal
 * matrix keys off `staff_role`; Directus keys off these display names, so
 * both spellings count as built-in (and therefore read-only in the admin
 * permission editor — their grants live in role-matrix.ts).
 */
const SEEDED_DIRECTUS_ROLE_NAMES: readonly string[] = [
  'Administrator',
  'Area Admin',
  'Zone Admin',
  'Branch Admin',
  'Department Leader',
  'Volunteer',
  'No Access',
]

export function isProtectedRole(name: string): boolean {
  return isBuiltInRole(name) || SEEDED_DIRECTUS_ROLE_NAMES.includes(name)
}

const ACTIONS: readonly PermissionAction[] = ['create', 'read', 'update', 'delete']

function toGrant(collection: unknown, action: unknown): Grant | null {
  if (typeof collection !== 'string' || collection.length === 0) return null
  // Session-bootstrap only, not a portal capability.
  if (collection === 'directus_users') return null
  if (!ACTIONS.includes(action as PermissionAction)) return null
  return {
    collection: collection as CollectionName,
    action: action as PermissionAction,
    scope: 'own_branch',
    note: 'custom role grant (Directus policy)',
  }
}

type DirectusEvent = Parameters<typeof directusFetch>[0]

export async function policiesForRole(
  event: DirectusEvent,
  token: string,
  roleId: string,
): Promise<string[]> {
  const access = await directusFetch<{ data: Array<{ policy: string | null }> }>(
    event,
    '/access',
    {
      accessToken: token,
      query: { filter: { role: { _eq: roleId } }, fields: 'policy', limit: -1 },
    },
  )
  return [
    ...new Set(
      (access.data ?? [])
        .map((row) => row.policy)
        .filter(
          (policy): policy is string => typeof policy === 'string' && policy.length > 0,
        ),
    ),
  ]
}

async function loadCustomGrants(
  event: DirectusEvent,
  token: string,
  staffRole: string,
): Promise<Grant[]> {
  const roles = await directusFetch<{ data: Array<{ id: string }> }>(event, '/roles', {
    accessToken: token,
    query: { filter: { name: { _eq: staffRole } }, fields: 'id', limit: 1 },
  })
  const role = (roles.data ?? [])[0]
  if (!role) return []
  const policies = await policiesForRole(event, token, role.id)
  if (policies.length === 0) return []
  const permissions = await directusFetch<{
    data: Array<{ collection: unknown; action: unknown }>
  }>(event, '/permissions', {
    accessToken: token,
    query: {
      filter: { policy: { _in: policies } },
      fields: 'collection,action',
      limit: -1,
    },
  })
  const seen = new Set<string>()
  const grants: Grant[] = []
  for (const row of permissions.data ?? []) {
    const grant = toGrant(row.collection, row.action)
    if (!grant) continue
    const key = `${grant.collection}:${grant.action}`
    if (seen.has(key)) continue
    seen.add(key)
    grants.push(grant)
  }
  return grants
}

/** Grants for a custom (non-built-in) staff role; [] for built-ins. */
export async function customGrantsForRole(
  event: DirectusEvent,
  staffRole: string,
): Promise<Grant[]> {
  if (isBuiltInRole(staffRole)) return []
  const hit = cache.get(staffRole)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.grants
  let grants: Grant[]
  try {
    const token = await directusAdminToken(event)
    try {
      grants = await loadCustomGrants(event, token, staffRole)
    } catch {
      // A stale cached admin token fails closed once, then retries fresh.
      forgetDirectusAdminToken()
      const fresh = await directusAdminToken(event)
      grants = await loadCustomGrants(event, fresh, staffRole)
    }
  } catch {
    grants = []
  }
  cache.set(staffRole, { at: Date.now(), grants })
  return grants
}

/**
 * Built-in staff role value -> Directus display name (AFC-836). The portal
 * keys overrides by staff_role; Directus keys roles by display name. Custom
 * roles need no entry: their Directus name IS the staff role value.
 */
export const BUILT_IN_DIRECTUS_DISPLAY_NAMES: Record<string, string> = {
  super_admin: 'Administrator',
  area_admin: 'Area Admin',
  zone_admin: 'Zone Admin',
  branch_admin: 'Branch Admin',
  department_leader: 'Department Leader',
  volunteer: 'Volunteer',
  none: 'No Access',
}

/** staff_role for a Directus role name, or null when it is not built-in. */
export function staffRoleForDirectusRoleName(name: string): string | null {
  for (const [staff, display] of Object.entries(BUILT_IN_DIRECTUS_DISPLAY_NAMES)) {
    if (display === name) return staff
  }
  return null
}

/** Display-name-first Directus role id lookup (AFC-836). */
export async function resolveDirectusRoleId(
  event: DirectusEvent,
  adminToken: string,
  staffRole: string,
): Promise<string | null> {
  const names = [staffRole, BUILT_IN_DIRECTUS_DISPLAY_NAMES[staffRole]].filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  )
  for (const name of names) {
    const found = await directusFetch<{ data: Array<{ id: string }> }>(event, '/roles', {
      accessToken: adminToken,
      query: { filter: { name: { _eq: name } }, fields: 'id', limit: 1 },
    }).catch(() => null)
    const id = found?.data?.[0]?.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

export interface RoleOverride {
  collection: string
  action: string
  effect: 'grant' | 'revoke'
}

const overridesCache = new Map<string, { at: number; rows: RoleOverride[] }>()

/** Super-admin matrix deltas for a staff role, newest read at most 60s old. */
export async function overridesForRole(
  event: Parameters<typeof directusFetch>[0],
  staffRole: string,
): Promise<RoleOverride[]> {
  const hit = overridesCache.get(staffRole)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows
  let rows: RoleOverride[]
  try {
    const token = await directusAdminToken(event)
    const load = () =>
      directusFetch<{
        data: Array<{ collection: string; action: string; effect: string }>
      }>(event, '/items/role_grant_overrides', {
        accessToken: token,
        query: {
          filter: { role_key: { _eq: staffRole } },
          fields: 'collection,action,effect',
          limit: -1,
        },
      })
    let res
    try {
      res = await load()
    } catch {
      forgetDirectusAdminToken()
      res = await load()
    }
    rows = (res.data ?? [])
      .filter((row) => row.effect === 'grant' || row.effect === 'revoke')
      .map((row) => ({
        collection: row.collection,
        action: row.action,
        effect: row.effect as 'grant' | 'revoke',
      }))
  } catch {
    rows = []
  }
  overridesCache.set(staffRole, { at: Date.now(), rows })
  return rows
}

/** Drop cached grant state for a role after a toggle (both caches). */
export function forgetRoleGrantCaches(staffRole: string): void {
  cache.delete(staffRole)
  overridesCache.delete(staffRole)
}

const overrideKey = (collection: string, action: string): string =>
  `${collection}:${action}`

/**
 * Apply super-admin deltas to a grant list (AFC-836). Revokes win over
 * everything; override grants append what the matrix and stored rows lack.
 * Pure: same input, same output, no I/O.
 */
export function applyOverrides(grants: Grant[], overrides: RoleOverride[]): Grant[] {
  const denied = new Set(
    overrides
      .filter((o) => o.effect === 'revoke')
      .map((o) => overrideKey(o.collection, o.action)),
  )
  const kept = grants.filter((g) => !denied.has(overrideKey(g.collection, g.action)))
  const have = new Set(kept.map((g) => overrideKey(g.collection, g.action)))
  for (const o of overrides) {
    if (o.effect === 'grant' && !have.has(overrideKey(o.collection, o.action))) {
      kept.push({
        collection: o.collection as CollectionName,
        action: o.action as PermissionAction,
        scope: 'all',
        note: 'super-admin override (AFC-836)',
      })
      have.add(overrideKey(o.collection, o.action))
    }
  }
  return kept
}

export interface StoredDirectusGrant {
  id: string
  policy: string
  collection: string
  action: string
  fields: unknown
  permissions: Record<string, unknown> | null
}

/**
 * Directus permission rows backing one triple on one role (AFC-836).
 * Used to snapshot before a revoke and to avoid duplicate creates.
 */
export async function storedDirectusGrants(
  event: DirectusEvent,
  adminToken: string,
  directusRoleId: string,
  collection: string,
  action: string,
): Promise<StoredDirectusGrant[]> {
  const policies = await policiesForRole(event, adminToken, directusRoleId)
  if (policies.length === 0) return []
  const rows = await directusFetch<{ data: Array<StoredDirectusGrant & { id: string }> }>(
    event,
    '/permissions',
    {
      accessToken: adminToken,
      query: {
        filter: {
          policy: { _in: policies },
          collection: { _eq: collection },
          action: { _eq: action },
        },
        fields: 'id,policy,collection,action,fields,permissions',
        limit: -1,
      },
    },
  ).catch(() => null)
  return (rows?.data ?? []).map((row) => ({
    id: row.id,
    policy: row.policy,
    collection: row.collection,
    action: row.action,
    fields: row.fields,
    permissions: (row.permissions ?? null) as Record<string, unknown> | null,
  }))
}

export interface OverrideRow {
  effect: 'grant' | 'revoke'
  snapshot: unknown
}

/** The override row for one triple, if a super admin recorded one. */
export async function readOverride(
  event: DirectusEvent,
  staffRole: string,
  collection: string,
  action: string,
): Promise<OverrideRow | null> {
  const found = await directusFetch<{
    data: Array<{ effect: string; snapshot: unknown }>
  }>(event, '/items/role_grant_overrides', {
    accessToken: (await directusAdminToken(event).catch(() => null)) ?? undefined,
    query: {
      filter: {
        role_key: { _eq: staffRole },
        collection: { _eq: collection },
        action: { _eq: action },
      },
      fields: 'effect,snapshot',
      limit: 1,
    },
  }).catch(() => null)
  const row = found?.data?.[0]
  if (!row || (row.effect !== 'grant' && row.effect !== 'revoke')) return null
  return { effect: row.effect, snapshot: row.snapshot ?? null }
}

/** Create or replace the override row for one triple. */
export async function writeOverride(
  event: DirectusEvent,
  staffRole: string,
  collection: string,
  action: string,
  effect: 'grant' | 'revoke',
  snapshot: unknown,
  createdBy: string | null,
): Promise<void> {
  const token = await directusAdminToken(event)
  const existing = await directusFetch<{ data: Array<{ id: string }> }>(
    event,
    '/items/role_grant_overrides',
    {
      accessToken: token,
      query: {
        filter: {
          role_key: { _eq: staffRole },
          collection: { _eq: collection },
          action: { _eq: action },
        },
        fields: 'id',
        limit: 1,
      },
    },
  ).catch(() => null)
  const existingId = existing?.data?.[0]?.id
  if (existingId) {
    await directusFetch(event, `/items/role_grant_overrides/${existingId}`, {
      accessToken: token,
      method: 'PATCH',
      body: { effect, snapshot: snapshot ?? null },
    })
    return
  }
  await directusFetch(event, '/items/role_grant_overrides', {
    accessToken: token,
    method: 'POST',
    body: {
      role_key: staffRole,
      collection,
      action,
      effect,
      snapshot: snapshot ?? null,
      created_by: createdBy,
    },
  })
}

/** Remove every override row for one triple. Returns true when one existed. */
export async function clearOverride(
  event: DirectusEvent,
  staffRole: string,
  collection: string,
  action: string,
): Promise<boolean> {
  const token = await directusAdminToken(event)
  const existing = await directusFetch<{ data: Array<{ id: string }> }>(
    event,
    '/items/role_grant_overrides',
    {
      accessToken: token,
      query: {
        filter: {
          role_key: { _eq: staffRole },
          collection: { _eq: collection },
          action: { _eq: action },
        },
        fields: 'id',
        limit: 1,
      },
    },
  ).catch(() => null)
  const existingId = existing?.data?.[0]?.id
  if (!existingId) return false
  await directusFetch(event, `/items/role_grant_overrides/${existingId}`, {
    accessToken: token,
    method: 'DELETE',
  })
  return true
}
