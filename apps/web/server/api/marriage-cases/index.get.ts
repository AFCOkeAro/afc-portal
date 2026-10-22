import { listQuerySchema } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope, officeZoneScope } from '../../utils/office'

/** GET /api/marriage-cases?stage= — scoped pipeline list (AFC-678 phase C). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-created_at',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-created_at' }
  const stage = typeof query.stage === 'string' ? query.stage : undefined
  logScopedQuery(scope, 'marriage-cases.list', { stage: stage ?? 'all' })

  try {
    const { data, meta } = await listItems<Record<string, unknown>>(
      event,
      scope,
      'marriage_cases',
      {
        filter: {
          ...officeBranchScope(scope),
          ...officeZoneScope(scope),
          ...(stage ? { stage: { _eq: stage } } : {}),
        },
        page: paging.page,
        limit: paging.limit,
        sort: paging.sort,
      },
    )
    return { data: stripHiddenMany(scope, 'marriage_cases', data), meta }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  }
})
