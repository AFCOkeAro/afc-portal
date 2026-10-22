import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * GET /api/admin/users?search= — staff directory for role assignment
 * (AFC-669). Area admins only. Returns identity + current staff role and
 * scope links; never password hashes.
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  const users = await directusFetch<{
    data: Array<{
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      staff_role: string | null
      status: string
      branch: string | null
      zone: string | null
      area: string | null
    }>
  }>(event, '/users', {
    accessToken: adminToken,
    query: {
      ...(search === '' ? {} : { search }),
      fields:
        'id,email,first_name,last_name,staff_role,status,branch,zone,area',
      limit: 25,
    },
  })
  return { data: users.data ?? [] }
})
