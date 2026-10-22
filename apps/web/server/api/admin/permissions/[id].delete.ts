import { requireArea } from '../../../utils/admin-guard'
import { isProtectedRole } from '../../../utils/custom-grants'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * DELETE /api/admin/permissions/:id — remove one custom permission
 * (AFC-669). Refused when the permission's policy backs a built-in role,
 * so the code matrix stays the single source of truth for built-ins.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const id = String(getRouterParam(event, 'id') ?? '')
  const permission = await directusFetch<{
    data: { id: string; policy: string | null }
  }>(event, `/permissions/${id}`, {
    accessToken: adminToken,
    query: { fields: 'id,policy' },
  }).catch(() => null)
  if (!permission?.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Permission not found',
      data: { code: 'not_found' },
    })
  }
  if (permission.data.policy) {
    const access = await directusFetch<{ data: Array<{ role: string | null }> }>(
      event,
      '/access',
      {
        accessToken: adminToken,
        query: {
          filter: { policy: { _eq: permission.data.policy } },
          fields: 'role',
          limit: -1,
        },
      },
    )
    for (const row of access.data ?? []) {
      if (!row.role) continue
      const role = await directusFetch<{ data: { name: string } }>(
        event,
        `/roles/${row.role}`,
        { accessToken: adminToken, query: { fields: 'name' } },
      ).catch(() => null)
      if (role?.data && isProtectedRole(role.data.name)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Built-in role permissions are governed by role-matrix.ts in code',
          data: { code: 'validation_error' },
        })
      }
    }
  }
  await directusFetch(event, `/permissions/${id}`, {
    accessToken: adminToken,
    method: 'DELETE',
  })
  return { data: { deleted: true } }
})
