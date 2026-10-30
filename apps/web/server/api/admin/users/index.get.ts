import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * GET /api/admin/users?search= — staff directory for role assignment
 * (AFC-669, AFC-914). Area admins only. Returns identity + current staff
 * role and scope links; never password hashes.
 *
 * With no `search`, returns the role holders: every user carrying a system
 * role (`staff_role` set and not `none`), so the Roles People tab lists all
 * persons with system roles without typing a query. With `search`, narrows
 * by name or email as before.
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
    // AFC-914: an empty query lists the role holders (system-role carriers),
    // not an arbitrary first page. Directus `_nin` does not match NULL, so
    // nulls are excluded with `_nnull` and the `none` placeholder with `_neq`.
    query:
      search === ''
        ? {
            filter: {
              _and: [{ staff_role: { _nnull: true } }, { staff_role: { _neq: 'none' } }],
            },
            fields: 'id,email,first_name,last_name,staff_role,status,branch,zone,area',
            sort: 'email',
            limit: 100,
          }
        : {
            search,
            fields: 'id,email,first_name,last_name,staff_role,status,branch,zone,area',
            limit: 25,
          },
  })
  return { data: users.data ?? [] }
})
