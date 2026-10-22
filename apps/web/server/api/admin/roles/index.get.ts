import { isProtectedRole } from '../../../utils/custom-grants'
import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

interface DirectusRole {
  id: string
  name: string
  description: string | null
}

/**
 * GET /api/admin/roles — Directus roles with a built-in/custom marker
 * (AFC-669). Built-in names resolve through the code matrix; anything else
 * is a custom role whose grants come from its Directus permissions.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const roles = await directusFetch<{ data: DirectusRole[] }>(event, '/roles', {
    accessToken: adminToken,
    query: { fields: 'id,name,description', limit: -1 },
  })
  const builtIn = (name: string): boolean => isProtectedRole(name)
  return {
    data: (roles.data ?? []).map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      builtIn: builtIn(role.name),
    })),
  }
})
