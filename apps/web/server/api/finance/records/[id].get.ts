import type { FinancialRecordRow } from '../../../../types/finance'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
  stripHidden,
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

/** GET /api/finance/records/:id — one capture with its lifecycle actors. */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branch_financial_records', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A record id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    id,
    { fields: visibleFields(scope, 'branch_financial_records', RECORD_FIELDS) },
  )
  const record = stripHidden(
    scope,
    'branch_financial_records',
    row,
  ) as unknown as FinancialRecordRow

  const names = await branchNames(event, scope)
  return {
    data: {
      ...record,
      id: String(record.id),
      branch_name: record.branch ? (names.get(String(record.branch)) ?? null) : null,
    },
  }
})
