import type { WecaReturnRow } from '../../../../types/finance'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
  visibleFields,
} from '../../../utils/portal'

const RETURN_FIELDS = [
  'id',
  'branch',
  'financial_record',
  'period',
  'computation_status',
  'formula_version',
  'computed_mf',
  'computed_area',
  'computed_savings',
  'computed_intervention',
  'computed_faith_city',
  'total_due',
  'generated_at',
  'submitted_at',
  'confirmed_at',
]

/**
 * GET /api/finance/returns — computed returns list (AFC-475, US-F2).
 *
 * Computed amounts are visible per §11.1 (area+): for other readers with a
 * read grant (branch admin, own rows) the computed fields are stripped by
 * `stripHiddenMany`, so a calculated return reads as its status and version,
 * never as leaked figures. `formula_pending` rows carry nulls from the
 * database itself, not from redaction -- the UI shows "pending board
 * formula" for those.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_returns', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const period = typeof query.period === 'string' ? query.period : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    {
      filter: mergeFilters(
        branch ? { branch: { _eq: branch } } : undefined,
        period ? { period: { _eq: period } } : undefined,
        status && status !== 'all' ? { computation_status: { _eq: status } } : undefined,
        scopeFilter(scope),
      ),
      fields: visibleFields(scope, 'weca_returns', RETURN_FIELDS),
      sort: '-period',
      page,
      limit,
    },
  )

  const names = await branchNames(event, scope)
  const recordIds = [
    ...new Set(
      result.data
        .map((row) => row.financial_record)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ]
  const months = new Map<string, string>()
  for (const recordId of recordIds) {
    try {
      const record = await findScopedItem<{ month: string }>(
        event,
        scope,
        'branch_financial_records',
        recordId,
        { fields: ['month'] },
      )
      months.set(recordId, record.month)
    } catch {
      // A return whose record left the caller's scope keeps its row; the
      // month simply reads empty rather than failing the whole list.
    }
  }

  const rows = stripHiddenMany(scope, 'weca_returns', result.data).map((row) => {
    const record = row as unknown as WecaReturnRow
    return {
      ...record,
      id: String(record.id),
      branch_name: record.branch ? (names.get(String(record.branch)) ?? null) : null,
      record_month: record.financial_record
        ? (months.get(String(record.financial_record)) ?? null)
        : null,
    }
  })

  return { data: rows, meta: result.meta }
})
