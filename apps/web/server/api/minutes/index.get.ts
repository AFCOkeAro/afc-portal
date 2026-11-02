import { z } from 'zod'
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
})
import { getPortalScope, listItems, requireCan } from '../../utils/portal'
import { logScopedQuery, officeBranchScope } from '../../utils/office'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-meeting_date',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-meeting_date' }
  logScopedQuery(scope, 'minutes.list', {})

  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    'office_minutes',
    {
      filter: { ...officeBranchScope(scope) },
      page: paging.page,
      limit: paging.limit,
      sort: paging.sort,
    },
  )
  return { data, meta }
})
