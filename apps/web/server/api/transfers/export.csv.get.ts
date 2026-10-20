import { TRANSFER_CSV_COLUMNS } from '@afc/shared'
import { csvResponse, getPortalScope, listItems, requireCan } from '../../utils/portal'
import { logScopedQuery, transferScope } from '../../utils/office'

/**
 * GET /api/transfers/export.csv?status= — permission-scoped CSV (US-U2 §9.2
 * pattern). Streams the same scoped query as the list over the same
 * collector shape, so the export cannot drift from the page.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'transfers', 'read')

  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : undefined
  logScopedQuery(scope, 'transfers.export', { status: status ?? 'all' })

  const { data } = await listItems<Record<string, unknown>>(event, scope, 'transfers', {
    filter: { ...transferScope(scope), ...(status ? { status: { _eq: status } } : {}) },
    fields: ['id', ...TRANSFER_CSV_COLUMNS],
    limit: -1,
    sort: '-request_date',
  })
  const rows: string[][] = [
    [...TRANSFER_CSV_COLUMNS],
    ...data.map((row) => TRANSFER_CSV_COLUMNS.map((column) => row[column])),
  ]
  return csvResponse(event, 'transfers.csv', rows)
})
