import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
} from '../../utils/portal'

/** GET /api/tasks/:id — scoped detail with the audit trail (404 when out of scope). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'read')

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(event, scope, 'tasks', id, {
    scope: scopeFilter(scope),
  })
  const trail = await listItems<Record<string, unknown>>(event, scope, 'task_events', {
    filter: { task: { _eq: id } },
    sort: 'created_at',
    limit: 100,
  })
  return { data: row, audit: trail.data }
})
