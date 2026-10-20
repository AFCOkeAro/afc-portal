import type { FinancialRecordRow } from '../../../../types/finance'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
  visibleFields,
} from '../../../utils/portal'

const RECORD_FIELDS = [
  'id',
  'branch',
  'month',
  'income',
  'intervention',
  'faith_city',
  'currency',
  'status',
  'submitted_by',
  'confirmed_by',
  'notes',
  'created_at',
  'updated_at',
]

/**
 * GET /api/finance/records — monthly branch capture list (AFC-475, US-F1).
 *
 * Amounts follow the §10 matrix through the shared field restriction
 * (`branch_financial_records` all-amounts → branch admin own / area+); the
 * branch-admin-own scoping is the query predicate (`scopeFilter`), the same
 * split portal.ts documents for every other scoped list.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branch_financial_records', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const month = typeof query.month === 'string' ? query.month : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    {
      filter: mergeFilters(
        branch ? { branch: { _eq: branch } } : undefined,
        month ? { month: { _eq: month } } : undefined,
        status && status !== 'all' ? { status: { _eq: status } } : undefined,
        scopeFilter(scope),
      ),
      fields: visibleFields(scope, 'branch_financial_records', RECORD_FIELDS),
      sort: '-month',
      page,
      limit,
    },
  )

  const names = await branchNames(event, scope)
  const rows = stripHiddenMany(
    scope,
    'branch_financial_records',
    result.data,
  ).map((row) => {
    const record = row as unknown as FinancialRecordRow
    return {
      ...record,
      id: String(record.id),
      branch_name: record.branch ? (names.get(String(record.branch)) ?? null) : null,
    }
  })

  return { data: rows, meta: result.meta }
})
