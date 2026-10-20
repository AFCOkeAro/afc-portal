import type { WecaReturnRow } from '../../../../types/finance'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
  stripHidden,
  visibleFields,
} from '../../../utils/portal'

// Same projection as the list route (welfare CASE_FIELDS precedent: each
// route names its own fields rather than importing across route modules).
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

/** GET /api/finance/returns/:id — one return with its lifecycle state. */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_returns', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A return id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    id,
    { fields: visibleFields(scope, 'weca_returns', RETURN_FIELDS) },
  )
  const record = stripHidden(scope, 'weca_returns', row) as unknown as WecaReturnRow

  let recordMonth: string | null = null
  if (record.financial_record) {
    try {
      const source = await findScopedItem<{ month: string }>(
        event,
        scope,
        'branch_financial_records',
        String(record.financial_record),
        { fields: ['month'] },
      )
      recordMonth = source.month
    } catch {
      recordMonth = null
    }
  }

  const names = await branchNames(event, scope)
  return {
    data: {
      ...record,
      id: String(record.id),
      branch_name: record.branch ? (names.get(String(record.branch)) ?? null) : null,
      record_month: recordMonth,
    },
  }
})
