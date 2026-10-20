import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
} from '../../utils/portal'

/** GET /api/minutes/:id — scoped detail with attendees + audit trail (US-E3 AC2). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'read')

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'office_minutes',
    id,
    {
      scope: scopeFilter(scope),
    },
  )
  const attendees = await listItems<Record<string, unknown>>(
    event,
    scope,
    'minutes_attendees',
    {
      filter: { minute: { _eq: id } },
      limit: 200,
    },
  )
  const trail = await listItems<Record<string, unknown>>(
    event,
    scope,
    'office_minute_events',
    {
      filter: { minute: { _eq: id } },
      sort: 'created_at',
      limit: 100,
    },
  )
  return { data: row, attendees: attendees.data, audit: trail.data }
})
