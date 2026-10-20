import { periodSchema } from '@afc/shared/weca'
import { z } from 'zod'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const createReturnSchema = z.object({
  financial_record: z.string().uuid(),
  period: periodSchema,
})

/**
 * POST /api/finance/returns — open a return for a branch period (AFC-475, US-F2).
 *
 * The portal only links the capture to its period. It never sets
 * `formula_version` or any computed field: the app's INSERT grant excludes
 * those columns, and the values arrive when `weca_compute_return()` (or the
 * `weca.calculate` Flow) runs against the effective formula version. A return
 * for a period with no effective version stays `formula_pending` with nulls
 * -- the row the database default already describes.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_returns', 'create')

  const body = (await readBody(event)) as Record<string, unknown>
  const parsed = createReturnSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)

  const record = await findScopedItem<{ branch: string; month: string }>(
    event,
    scope,
    'branch_financial_records',
    parsed.data.financial_record,
    { fields: ['branch', 'month'] },
  )

  if (String(record.month).slice(0, 7) !== parsed.data.period) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The period must match the financial record month.',
      data: { code: 'period_mismatch' },
    })
  }

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    {
      branch: record.branch,
      financial_record: parsed.data.financial_record,
      period: parsed.data.period,
      generated_by: scope.session.user.id,
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
