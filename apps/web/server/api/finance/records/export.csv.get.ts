import {
  branchNames,
  csvResponse,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  visibleFields,
} from '../../../utils/portal'

/**
 * Records CSV (AFC-475, US-F3). Serialises the same scoped query the list
 * route reads, with amounts only when the caller's grants reveal them
 * (§11.1). The export carries input fields only -- computed lines live on
 * the returns export, so the two files cannot disagree about a number.
 */
const MAX_EXPORT_ROWS = 20000

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branch_financial_records', 'read')

  const query = getQuery(event)
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const month = typeof query.month === 'string' ? query.month : undefined
  const status = typeof query.status === 'string' ? query.status : undefined

  const fields = visibleFields(scope, 'branch_financial_records', [
    'branch',
    'month',
    'income',
    'intervention',
    'faith_city',
    'currency',
    'status',
  ])

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
      fields,
      sort: '-month',
      limit: MAX_EXPORT_ROWS,
    },
  )

  if (result.meta.total > MAX_EXPORT_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That export is too large. Narrow the filters, then export again.',
      data: { code: 'range_too_large' },
    })
  }

  const names = await branchNames(event, scope)
  const show = (name: string): boolean => fields.includes(name)
  const cell = (row: Record<string, unknown>, name: string): string => {
    if (!show(name)) return ''
    const value = row[name]
    return value === null || value === undefined ? '' : String(value)
  }

  const rows: string[][] = [
    ['branch', 'month', 'income', 'intervention', 'faith_city', 'currency', 'status'],
    ...result.data.map((row) => [
      names.get(String(row.branch)) ?? String(row.branch ?? ''),
      cell(row, 'month'),
      cell(row, 'income'),
      cell(row, 'intervention'),
      cell(row, 'faith_city'),
      cell(row, 'currency'),
      cell(row, 'status'),
    ]),
  ]

  return csvResponse(event, 'financial-records.csv', rows)
})
