import { listQuerySchema } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'
import { logScopedQuery, transferScope } from '../../utils/office'

/**
 * GET /api/transfers?status=&page=&limit=&sort=
 *
 * Scoped transfer list (US-E4). Scope is from_branch OR to_branch; area
 * staff see everything. Returns the audit-light row; the detail route
 * carries the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'transfers', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    search: query.search,
    sort: query.sort ?? '-request_date',
  })
  const filters = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, search: undefined, sort: '-request_date' }

  const status = typeof query.status === 'string' ? query.status : undefined
  logScopedQuery(scope, 'transfers.list', { status: status ?? 'all' })

  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    'transfers',
    {
      filter: {
        ...transferScope(scope),
        ...(status ? { status: { _eq: status } } : {}),
      },
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort,
    },
  )
  return { data: stripHiddenMany(scope, 'transfers', data), meta }
})
