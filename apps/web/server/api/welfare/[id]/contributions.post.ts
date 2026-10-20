import { z } from 'zod'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const contributionSchema = z.object({
  contribution_type: z.enum(['cash', 'goods', 'service']).default('cash'),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Expected a decimal amount')
    .optional()
    .or(z.literal('')),
  description: z.string().trim().max(4000).optional(),
  contributor: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'approved', 'disbursed']).default('pending'),
})

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_contributions', 'create')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A case id is required' })
  await findScopedItem(event, scope, 'welfare_cases', id, { fields: ['id'] })

  const parsed = contributionSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const amount = form.amount && form.amount !== '' ? form.amount : null
  if (!amount && form.contribution_type === 'cash') {
    throw createError({
      statusCode: 400,
      statusMessage: 'A cash contribution needs an amount',
      data: {
        code: 'validation_error',
        fields: { amount: 'Enter the amount received' },
      },
    })
  }

  const now = new Date().toISOString()
  const approved = form.status !== 'pending'
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_contributions',
    {
      case: id,
      contribution_type: form.contribution_type,
      amount,
      description: form.description ?? null,
      contributor: form.contributor ?? null,
      contributed_at: now,
      status: form.status,
      approved_by: approved ? scope.session.user.id : null,
      approved_at: approved ? now : null,
    },
  )

  await createItem(event, scope, 'welfare_case_events', {
    case: id,
    event_type: 'contribution',
    summary: `${form.contribution_type} contribution recorded${amount ? ` (${amount})` : ''}`,
    actor: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
