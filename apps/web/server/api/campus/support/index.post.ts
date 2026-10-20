import { z } from 'zod'
import { stripSupport, supportTotal } from '../../../utils/campus'
import { directusFetch } from '../../../utils/directus'
import {
  createItem,
  getPortalScope,
  listItems,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const supportFormSchema = z.object({
  student: z.string().uuid('Choose a student'),
  programme: z.string().uuid().nullish(),
  amount: z.number().min(0, 'Amount cannot be negative').nullish(),
  term: z.string().max(200).nullish(),
  source: z.string().max(300).nullish(),
  status: z.enum(['proposed', 'approved', 'disbursed']).default('proposed'),
  approved_by: z.string().uuid().nullish(),
  support_date: z.string().date().nullish(),
})

/**
 * POST /api/campus/support — record financial support (US-C4 AC2).
 *
 * proposed → approved → disbursed is a route lifecycle (the status moves
 * forward; only the create sets it here). The student must sit inside the
 * caller's scope. The response carries the student's derived
 * `support_total` (Σ disbursed) so the UI shows it without a second read;
 * the stored Flow-maintained column remains the system of record.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_financial_support', 'create')

  const parsed = supportFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (!scope.isArea) {
    const studentRow = await directusFetch<{
      data: Array<Record<string, unknown>>
    }>(event, '/items/campus_students', {
      accessToken: scope.token,
      query: {
        fields: 'id,branch,zone',
        limit: 1,
        filter: { id: { _eq: form.student } },
      },
    }).catch(() => {
      throw createError({
        statusCode: 404,
        statusMessage: 'That student was not found in your scope',
        data: { code: 'not_found' },
      })
    })
    const found = studentRow.data[0]
    const inBranch =
      found?.branch != null && scope.branchIds.includes(String(found.branch))
    const inZone =
      found?.zone != null && scope.zoneIds.includes(String(found.zone))
    if (!inBranch && !inZone) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That student was not found in your scope',
        data: { code: 'not_found' },
      })
    }
  }

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'campus_financial_support',
    {
      student: form.student,
      programme: form.programme ?? null,
      amount: form.amount ?? null,
      term: form.term ?? null,
      source: form.source ?? null,
      status: form.status,
      approved_by: form.approved_by ?? null,
      support_date: form.support_date ?? null,
      created_at: now,
      updated_at: now,
    },
  )

  let support_total: number | null = null
  if (!scope.hiddenFields.campus_financial_support?.includes('amount')) {
    try {
      const rows = await listItems<Record<string, unknown>>(
        event,
        scope,
        'campus_financial_support',
        {
          filter: { student: { _eq: form.student } },
          fields: ['amount', 'status'],
          limit: 200,
        },
      )
      support_total = supportTotal(rows.data)
    } catch {
      support_total = null
    }
  }

  return {
    data: stripSupport(scope, { ...created, id: String(created.id) }),
    meta: { support_total },
  }
})
