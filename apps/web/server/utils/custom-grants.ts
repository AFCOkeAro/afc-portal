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
  let grants: Grant[] = []
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
