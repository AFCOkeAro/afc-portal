import { requireArea } from '../../../../utils/admin-guard'
import { policiesForRole } from '../../../../utils/custom-grants'
import { directusFetch } from '../../../../utils/directus'
import { directusAdminToken } from '../../../../utils/directus-admin'

/**
 * GET /api/admin/roles/:id/permissions — the custom permission set behind
 * one role (AFC-669), resolved through its access -> policy links. Only
 * meaningful (and only editable) for custom roles; built-ins are governed
 * by role-matrix.ts in code.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const id = String(getRouterParam(event, 'id') ?? '')
  const policies = await policiesForRole(event, adminToken, id)
  if (policies.length === 0) return { data: [] }
  const permissions = await directusFetch<{
    data: Array<{
      id: string
      collection: string
      action: string
      permissions: Record<string, unknown> | null
    }>
  }>(event, '/permissions', {
    accessToken: adminToken,
    query: {
      filter: { policy: { _in: policies } },
      fields: 'id,collection,action,permissions',
      limit: -1,
    },
  })
  return {
    data: (permissions.data ?? []).map((row) => ({
      id: row.id,
      // System collection, presented under its familiar name.
      collection: row.collection === 'directus_users' ? 'users' : row.collection,
      action: row.action,
      filter: row.permissions,
    })),
  }
})
