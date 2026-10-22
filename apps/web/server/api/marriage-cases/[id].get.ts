import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
  stripHidden,
} from '../../utils/portal'
import { officeZoneScope } from '../../utils/office'

/**
 * GET /api/marriage-cases/:id — scoped detail with trail + task checklist
 * (AFC-678 phase C). The trail is the `marriage_case_events` rows; the
 * checklist is the `tasks` rows with related_id = case id.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'read')

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
  ).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  })

  const trail = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_case_events',
    { filter: { marriage_case: { _eq: id } }, sort: 'created_at', limit: 200 },
  ).catch(() => ({ data: [], meta: { total: 0, page: 1, limit: 200 } }))

  const tasks = await listItems<Record<string, unknown>>(event, scope, 'tasks', {
    filter: { related_id: { _eq: id } },
    sort: 'due_date',
    limit: 100,
  }).catch(() => ({ data: [], meta: { total: 0, page: 1, limit: 100 } }))

  const done = tasks.data.filter(
    (t: Record<string, unknown>) => t.status === 'done' || t.status === 'cancelled',
  ).length
  return {
    data: stripHidden(scope, 'marriage_cases', row),
    audit: trail.data,
    tasks: tasks.data,
    meta: { tasksTotal: tasks.data.length, tasksDone: done },
  }
})
