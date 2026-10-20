import { listQuerySchema } from '@afc/shared'
import { can, getPortalScope, listItems, requireCan } from '../../utils/portal'
import { announcementScope, logScopedQuery } from '../../utils/office'

/**
 * GET /api/announcements — scoped list (US-E3 AC3).
 *
 * Readers without update rights see only published rows inside the publish
 * window (announcement build-up: draft → scheduled → published). Writers
 * see everything in scope, including drafts awaiting approval.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'announcements', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-publish_from',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-publish_from' }
  logScopedQuery(scope, 'announcements.list', {})

  const writer = can(scope, 'announcements', 'update')
  const now = new Date().toISOString()
  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    'announcements',
    {
      filter: {
        ...announcementScope(scope),
        ...(writer
          ? {}
          : {
              status: { _eq: 'published' },
              publish_from: { _lte: now },
            }),
      },
      page: paging.page,
      limit: paging.limit,
      sort: paging.sort,
    },
  )
  return { data, meta }
})
