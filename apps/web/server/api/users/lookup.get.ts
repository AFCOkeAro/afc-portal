import { can, getPortalScope } from '../../utils/portal'
import { directusFetch } from '../../utils/directus'
import { directusAdminToken } from '../../utils/directus-admin'

/**
 * GET /api/users/lookup?search= — staff directory picker for intake (AFC-907).
 *
 * Minimal rows (id + display name + role + branch) so Invited by and
 * Follow-up owner can be picked from real users instead of free text.
 * Reads as the Directus administrator because intake roles (including
 * volunteers with visitors:create) cannot read /users with their own
 * token; branch scoping keeps it smallest-defensible (area sees all,
 * otherwise own branches plus branch-less area staff). Never returns
 * password hashes, tokens or provider data.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!can(scope, 'visitors', 'read') && !can(scope, 'visitors', 'create')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Visitors intake is required to pick a user',
      data: { code: 'forbidden' },
    })
  }

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : ''
  // Single-user resolve for edit forms (display name for a stored id).
  const onlyId =
    typeof query.id === 'string' && query.id.trim() !== '' ? query.id.trim() : null

  try {
    const adminToken = await directusAdminToken(event)
    const filters: Array<Record<string, unknown>> =
      onlyId !== null ? [{ id: { _eq: onlyId } }] : [{ status: { _neq: 'archived' } }]
    if (search !== '') {
      filters.push({
        _or: [
          { first_name: { _icontains: search } },
          { last_name: { _icontains: search } },
          { email: { _icontains: search } },
        ],
      })
    }
    if (!scope.isArea) {
      filters.push({
        _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
      })
    }
    const users = await directusFetch<{
      data: Array<{
        id: string
        first_name: string | null
        last_name: string | null
        email: string | null
        staff_role: string | null
        branch: string | null
      }>
    }>(event, '/users', {
      accessToken: adminToken,
      query: {
        filter: { _and: filters },
        fields: 'id,first_name,last_name,email,staff_role,branch',
        sort: 'first_name',
        limit: 25,
      },
    })
    return {
      data: (users.data ?? []).map((row) => {
        const full = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
        return {
          id: String(row.id),
          name: full === '' ? (row.email ?? 'Unnamed user') : full,
          email: row.email,
          staff_role: row.staff_role,
          branch: row.branch,
        }
      }),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'Could not load the user list',
      data: { code: 'unavailable' },
    })
  }
})
