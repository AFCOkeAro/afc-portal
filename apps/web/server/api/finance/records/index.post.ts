import { financialRecordFormSchema, toFinancialRecordPayload } from '@afc/shared/weca'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../../utils/portal'

/**
 * POST /api/finance/records — capture a month's inputs (AFC-475, US-F1).
 *
 * The form sends what the treasurer typed; the computation never happens
 * here. Records are always created `draft`: submission is an audited
 * lifecycle step on the detail route, not a creation flag, so a record can
 * never arrive already submitted with no actor in `submitted_by`.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branch_financial_records', 'create')

  const body = (await readBody(event)) as Record<string, unknown>
  const parsed = financialRecordFormSchema.safeParse({
    intervention: '',
    faith_city: '',
    ...body,
    status: 'draft',
  })
  if (!parsed.success) throwValidation(parsed.error)

  const branch = resolveBranch(scope, parsed.data.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required',
      data: { code: 'branch_required' },
    })
  }

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    {
      ...toFinancialRecordPayload(parsed.data),
      branch,
      status: 'draft',
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
