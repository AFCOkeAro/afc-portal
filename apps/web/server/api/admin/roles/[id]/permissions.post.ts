import { COLLECTIONS } from '@afc/shared'
import { requireArea } from '../../../../utils/admin-guard'
import { isProtectedRole, policiesForRole } from '../../../../utils/custom-grants'
import { directusFetch } from '../../../../utils/directus'
import { directusAdminToken } from '../../../../utils/directus-admin'

const ACTIONS = ['create', 'read', 'update', 'delete'] as const

/**
 * POST /api/admin/roles/:id/permissions — add one custom permission
 * (collection + action) to a custom role's policy (AFC-669). Refused for
 * built-in roles: those grants live in role-matrix.ts, and a second source
 * of truth would silently disagree with the enforced one.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const id = String(getRouterParam(event, 'id') ?? '')
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
  }
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
  if (isProtectedRole(role.data.name)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Built-in roles are governed by role-matrix.ts in code',
      data: { code: 'validation_error' },
    })
  }
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
  return { data: { id: created.data.id } }
})
