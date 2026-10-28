import { COLLECTIONS } from '@afc/shared'
import { grantsForRole } from '@afc/shared/role-matrix'
import { requireSuperAdmin } from '../../../../utils/admin-guard'
import {
  forgetRoleGrantCaches,
  isProtectedRole,
  readOverride,
  staffRoleForDirectusRoleName,
  storedDirectusGrants,
  writeOverride,
} from '../../../../utils/custom-grants'
import { directusFetch } from '../../../../utils/directus'
import { directusAdminToken } from '../../../../utils/directus-admin'

/**
 * POST /api/admin/roles/:id/revocations — deny a built-in grant
 * (AFC-836, super_admin only).
 *
 * Records a revoke override AND deletes the matching Directus permission
 * rows (snapshotted into the override), so the portal gate and the
 * Directus policy agree. Built-in roles only: custom roles revoke by
 * deleting their Directus row (DELETE /api/admin/permissions/:id).
 * 400 when nothing confers the grant (nothing to revoke).
 */
export default defineEventHandler(async (event) => {
  const superScope = await requireSuperAdmin(event)
  const adminToken = await directusAdminToken(event)
  const body = await readBody<{
    collection?: unknown
    action?: unknown
  }>(event)
  const collection = typeof body?.collection === 'string' ? body.collection : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  const knownCollections = new Set<string>(Object.values(COLLECTIONS))
  const ACTIONS = ['create', 'read', 'update', 'delete']
  if (!knownCollections.has(collection) || !ACTIONS.includes(action)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown collection or action',
      data: { code: 'validation_error' },
    })
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
  const staffKey = staffRoleForDirectusRoleName(role.data.name) ?? role.data.name
  if (!isProtectedRole(role.data.name)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Revocations are for built-in roles; delete the custom permission instead',
      data: { code: 'validation_error' },
    })
  }
  const matrixGrants = grantsForRole(staffKey as never).some(
    (grant) => grant.collection === collection && grant.action === action,
  )
  const prior = await readOverride(event, staffKey, collection, action)
  const stored = await storedDirectusGrants(event, adminToken, id, collection, action)
  const effective = matrixGrants || stored.length > 0 || prior?.effect === 'grant'
  if (!effective) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nothing confers that grant',
      data: { code: 'nothing_to_revoke' },
    })
  }
  const snapshot = stored.map((row) => ({
    id: row.id,
    policy: row.policy,
    collection: row.collection,
    action: row.action,
    fields: row.fields,
    permissions: row.permissions,
  }))
  for (const row of stored) {
    await directusFetch(event, `/permissions/${row.id}`, {
      accessToken: adminToken,
      method: 'DELETE',
    })
  }
  await writeOverride(
    event,
    staffKey,
    collection,
    action,
    'revoke',
    {
      deleted: snapshot,
      created: [],
    },
    superScope.session.user.id,
  )
  forgetRoleGrantCaches(staffKey)
  return { data: { revoked: true, removed: stored.length } }
})
