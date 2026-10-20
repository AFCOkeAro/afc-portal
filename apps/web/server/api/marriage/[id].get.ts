import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
} from '../../utils/portal'

/** GET /api/marriage/:id — scoped detail with the audit trail (404 when out of scope). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_matters', 'read')

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_matters',
    id,
    {
      scope: scopeFilter(scope),
    },
  )
  const trail = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_matter_events',
    {
      filter: { marriage_matter: { _eq: id } },
      sort: 'created_at',
      limit: 100,
    },
  )
  return { data: row, audit: trail.data }
})
