import { TASK_CSV_COLUMNS } from '@afc/shared'
import { csvResponse, getPortalScope, listItems, requireCan } from '../../utils/portal'
import { logScopedQuery, officeBranchScope } from '../../utils/office'

/** GET /api/tasks/export.csv?status= — permission-scoped CSV over the list query. */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'read')

  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : undefined
  logScopedQuery(scope, 'tasks.export', { status: status ?? 'all' })

  const { data } = await listItems<Record<string, unknown>>(event, scope, 'tasks', {
    filter: {
      ...officeBranchScope(scope),
      ...(status ? { status: { _eq: status } } : {}),
    },
    fields: [
      'id',
      'title',
      'assignee_user',
      'assignee_person',
      'status',
      'priority',
      'due_date',
      'branch',
    ],
    limit: -1,
    sort: 'due_date',
  })
  const rows: string[][] = [
    [...TASK_CSV_COLUMNS],
    ...data.map((row) => [
      String(row.title ?? ''),
      String(row.assignee_user ?? row.assignee_person ?? ''),
      String(row.status ?? ''),
      String(row.priority ?? ''),
      String(row.due_date ?? ''),
      String(row.branch ?? ''),
    ]),
  ]
  return csvResponse(event, 'tasks.csv', rows)
})
