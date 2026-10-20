import { listQuerySchema } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope, officeZoneScope } from '../../utils/office'

/** GET /api/marriage?status=&matter_type= — scoped marriage-matter list (US-E4 AC2). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_matters', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-created_at',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-created_at' }
  const status = typeof query.status === 'string' ? query.status : undefined
  logScopedQuery(scope, 'marriage.list', { status: status ?? 'all' })

  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_matters',
    {
      filter: {
        ...officeBranchScope(scope),
        ...officeZoneScope(scope),
        ...(status ? { status: { _eq: status } } : {}),
      },
      page: paging.page,
      limit: paging.limit,
      sort: paging.sort,
    },
  )
  return { data: stripHiddenMany(scope, 'marriage_matters', data), meta }
})
