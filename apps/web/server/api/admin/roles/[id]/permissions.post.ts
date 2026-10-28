import { COLLECTIONS } from '@afc/shared'
import { grantsForRole } from '@afc/shared/role-matrix'
import { requireArea, requireSuperAdmin } from '../../../../utils/admin-guard'
import {
  clearOverride,
  forgetRoleGrantCaches,
  isProtectedRole,
  policiesForRole,
  readOverride,
  staffRoleForDirectusRoleName,
  storedDirectusGrants,
  writeOverride,
} from '../../../../utils/custom-grants'
import { directusFetch } from '../../../../utils/directus'
import { directusAdminToken } from '../../../../utils/directus-admin'
import {
  MINUTES_ATTENDEE_CREATE_ACTION,
  MINUTES_ATTENDEE_CREATE_COLLECTION,
  minutesAttendeeCreateFilter,
} from '../../../../utils/minutes-policy'

const ACTIONS = ['create', 'read', 'update', 'delete'] as const

/**
 * POST /api/admin/roles/:id/permissions — grant a collection + action
 * (AFC-669, extended AFC-836).
 *
 * Custom roles (unchanged path): requireArea; creates a Directus permission
 * row on the role's policy.
 *
 * Built-in roles (AFC-836): super_admin only. The grant is recorded as an
 * explicit super-admin override AND mirrored as a Directus permission row,
 * so the portal gate and the Directus policy agree. An existing
 * revoke-override for the triple is honoured first (its snapshotted
 * Directus rows are restored), then the triple is ensured granted.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const body = await readBody<{
    collection?: unknown
    action?: unknown
    filter?: unknown
  }>(event)
  const collection = typeof body?.collection === 'string' ? body.collection : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  const knownCollections = new Set<string>(Object.values(COLLECTIONS))
  // `users:read` (usually with an own-row filter) is the session bootstrap:
  // login reads /users/me with the user's own token, so a custom role
  // without it fails closed to zero grants.
  const selfRead = collection === 'users' && action === 'read'
  const storedCollection = selfRead ? 'directus_users' : collection
  if (
    (!knownCollections.has(collection) && !selfRead) ||
    !ACTIONS.includes(action as never)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown collection or action',
      data: { code: 'validation_error' },
    })
  }
  // Optional row filter (a Directus filter object), e.g. {"zone":{"_eq":"…"}}.
  // Lets a custom permission narrow to rows instead of whole collections.
  // F1 mirror (AFC-704, ADR-0012): a minutes_attendees:create grant without
  // a filter lets the holder attach to ANY minutes through the Directus API,
  // bypassing the portal's own-draft rule. Default to the canonical mirror
  // filter unless the admin supplies one explicitly -- a supplied filter
  // replaces the default and the admin owns the F1 parity obligation then.
  let filter: Record<string, unknown> | undefined
  if (body?.filter !== undefined) {
    if (
      typeof body.filter !== 'object' ||
      body.filter === null ||
      Array.isArray(body.filter)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Filter must be a JSON object',
        data: { code: 'validation_error', fields: { filter: 'Must be an object' } },
      })
    }
    filter = body.filter as Record<string, unknown>
  } else if (
    collection === MINUTES_ATTENDEE_CREATE_COLLECTION &&
    action === MINUTES_ATTENDEE_CREATE_ACTION
  ) {
    filter = minutesAttendeeCreateFilter()
  }
  const id = String(getRouterParam(event, 'id') ?? '')
  const role = await directusFetch<{ data: { id: string; name: string } }>(
    event,
    `/roles/${id}`,
    { accessToken: adminToken, query: { fields: 'id,name' } },
  ).catch(() => null)
  if (!role?.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Role not found',
      data: { code: 'not_found' },
    })
  }
  const builtIn = isProtectedRole(role.data.name)
  const staffKey = builtIn
    ? (staffRoleForDirectusRoleName(role.data.name) ?? role.data.name)
    : role.data.name
  if (!builtIn) {
    let policies = await policiesForRole(event, adminToken, id)
    if (policies.length === 0) {
      const policy = await directusFetch<{ data: { id: string } }>(event, '/policies', {
        accessToken: adminToken,
        method: 'POST',
        body: { name: `${role.data.name} policy`, app_access: true, admin_access: false },
      })
      await directusFetch(event, '/access', {
        accessToken: adminToken,
        method: 'POST',
        body: { role: id, policy: policy.data.id },
      })
      policies = [policy.data.id]
    }
    const created = await directusFetch<{ data: { id: string } }>(event, '/permissions', {
      accessToken: adminToken,
      method: 'POST',
      body: {
        policy: policies[0],
        collection: storedCollection,
        action,
        fields: ['*'],
        ...(filter === undefined ? {} : { permissions: filter }),
      },
    })
    forgetRoleGrantCaches(staffKey)
    return { data: { id: created.data.id } }
  }

  // Built-in path: super admins only, recorded as an explicit override so
  // the change is visible, audited, and reversible (never a silent edit).
  const superScope = await requireSuperAdmin(event)
  const prior = await readOverride(event, staffKey, storedCollection, action)
  if (prior && prior.effect === 'revoke') {
    const snap = (prior.snapshot ?? {}) as { deleted?: Array<Record<string, unknown>> }
    const failures: unknown[] = []
    for (const row of snap.deleted ?? []) {
      try {
        await directusFetch(event, '/permissions', {
          accessToken: adminToken,
          method: 'POST',
          body: {
            policy: row.policy,
            collection: row.collection,
            action: row.action,
            fields: row.fields ?? ['*'],
            ...(row.permissions ? { permissions: row.permissions } : {}),
          },
        })
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Could not restore a revoked permission; nothing was changed',
        data: { code: 'unavailable' },
      })
    }
    await clearOverride(event, staffKey, storedCollection, action)
  }
  const matrixGrants = grantsForRole(staffKey as never).some(
    (grant) => grant.collection === storedCollection && grant.action === action,
  )
  const existing = await storedDirectusGrants(
    event,
    adminToken,
    id,
    storedCollection,
    action,
  )
  let createdId: string | null = null
  if (existing.length === 0) {
    let policies = await policiesForRole(event, adminToken, id)
    if (policies.length === 0) {
      const policy = await directusFetch<{ data: { id: string } }>(event, '/policies', {
        accessToken: adminToken,
        method: 'POST',
        body: { name: `${role.data.name} policy`, app_access: true, admin_access: false },
      })
      await directusFetch(event, '/access', {
        accessToken: adminToken,
        method: 'POST',
        body: { role: id, policy: policy.data.id },
      })
      policies = [policy.data.id]
    }
    const created = await directusFetch<{ data: { id: string } }>(event, '/permissions', {
      accessToken: adminToken,
      method: 'POST',
      body: {
        policy: policies[0],
        collection: storedCollection,
        action,
        fields: ['*'],
        ...(filter === undefined ? {} : { permissions: filter }),
      },
    })
    createdId = created.data.id
  }
  if (!matrixGrants) {
    await writeOverride(
      event,
      staffKey,
      storedCollection,
      action,
      'grant',
      { created: createdId ? [createdId] : [], deleted: [] },
      superScope.session.user.id,
    )
  }
  forgetRoleGrantCaches(staffKey)
  return { data: { id: createdId, effective: true } }
})
