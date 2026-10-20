import {
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
} from '../../utils/portal'
import { announcementScope } from '../../utils/office'

/** GET /api/announcements/:id — scoped detail with the approval trail (404 when out of scope). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'announcements', 'read')

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'announcements',
    id,
    {
      scope: announcementScope(scope),
    },
  )

  // Drafts are writer-only: a reader who guessed the id still 404s.
  if (row.status !== 'published' && !can(scope, 'announcements', 'update')) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That record was not found in your scope',
      data: { code: 'not_found' },
    })
  }

  const trail = await listItems<Record<string, unknown>>(
    event,
    scope,
    'announcement_events',
    {
      filter: { announcement: { _eq: id } },
      sort: 'created_at',
      limit: 100,
    },
  )
  return { data: row, audit: trail.data }
})
