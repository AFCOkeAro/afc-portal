import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
} from '../../utils/portal'
import { resolveTaskPeople } from '../../utils/office'

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
  const { ownerByTask, personNames } = await resolveTaskPeople(event, scope, [row])
  const nameOf = (value: unknown): string | null =>
    typeof value === 'string' ? (personNames.get(value) ?? null) : null
  return {
    data: {
      ...row,
      owner_name: ownerByTask.get(String(row.id)) ?? null,
      raci_names: {
        responsible: nameOf(row.raci_responsible),
        accountable: nameOf(row.raci_accountable),
        consulted: nameOf(row.raci_consulted),
        informed: nameOf(row.raci_informed),
      },
    },
    audit: trail.data,
  }
})
