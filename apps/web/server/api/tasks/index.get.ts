import { listQuerySchema } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope } from '../../utils/office'

/**
 * GET /api/tasks?status=&mine=1&branch= — scoped task list (US-E3 AC1).
 * `mine=1` narrows to rows assigned to the session user (assignee-scoped
 * views); `branch=` narrows to one branch (used by the event Tasks tab,
 * AFC-666). Overdue highlighting is computed client-side from due_date +
 * status via the shared `isTaskOverdue` helper, never stored.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? 'due_date',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: 'due_date' }
  const status = typeof query.status === 'string' ? query.status : undefined
  const mine = query.mine === '1'
  const branch =
    typeof query.branch === 'string' && query.branch.length > 0
      ? query.branch
      : undefined
  logScopedQuery(scope, 'tasks.list', {
    status: status ?? 'all',
    mine,
    branch: branch ?? 'all',
  })

  const { data, meta } = await listItems<Record<string, unknown>>(event, scope, 'tasks', {
    filter: {
      ...officeBranchScope(scope),
      ...(status ? { status: { _eq: status } } : {}),
      ...(mine ? { assignee_user: { _eq: scope.session.user.id } } : {}),
      ...(branch ? { branch: { _eq: branch } } : {}),
    },
    page: paging.page,
    limit: paging.limit,
    sort: paging.sort,
  })
  return { data: stripHiddenMany(scope, 'tasks', data), meta }
})
