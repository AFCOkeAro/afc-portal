import { financialRecordFormSchema, toFinancialRecordPayload } from '@afc/shared/weca'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const TRANSITIONS: Record<string, string | null> = {
  draft: 'submitted',
  submitted: 'confirmed',
}

/**
 * PATCH /api/finance/records/:id — edit a draft, or move the lifecycle.
 *
 * Two shapes, kept apart on purpose:
 * - `{ status }` alone performs the audited transition `draft → submitted →
 *   confirmed` and stamps the actor (`submitted_by` / `confirmed_by`). The
 *   stamp columns are the audit trail (prd-expansion §5.2); the Directus
 *   activity log holds the same transition with its timestamp as backstop.
 *   There is no separate audit collection for finance, so no audit row is
 *   written here -- inventing one would fork the audit contract.
 * - A full form body rewrites a `draft` only. Editing a submitted or
 *   confirmed record in place would rewrite audited inputs, so it is a 409;
 *   the correction path is a reviewed step outside this slice.
 *
 * Confirmation is granted by the matrix (`CRU own` for branch admin): the
 * route does not invent a narrower "area confirms" rule the spec never
 * states. If the board wants area-only confirmation, that is a matrix change
 * with a Directus policy to match -- flagged for the CTO.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branch_financial_records', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A record id is required' })
  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    id,
    { fields: ['id', 'status'] },
  )
  const current = String(existing.status)

  const body = (await readBody(event)) as Record<string, unknown>

  if (Object.keys(body).length === 1 && typeof body.status === 'string') {
    const next = body.status
    if (TRANSITIONS[current] !== next) {
      throw createError({
        statusCode: 409,
        statusMessage:
          current === 'confirmed'
            ? 'A confirmed record cannot move again. Correct it with a reviewed step.'
            : `A ${current} record moves to ${TRANSITIONS[current] ?? 'nowhere'} next, not to ${next}.`,
        data: { code: 'invalid_transition', status: current },
      })
    }
    const actorField = next === 'submitted' ? 'submitted_by' : 'confirmed_by'
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'branch_financial_records',
      id,
      {
        status,
        [actorField]: scope.session.user.id,
        updated_at: new Date().toISOString(),
      },
    )
    return { data: { ...updated, id: String((updated as Record<string, unknown>).id) } }
  }

  if (current !== 'draft') {
    throw createError({
      statusCode: 409,
      statusMessage: `A ${current} record is audited and cannot be edited in place.`,
      data: { code: 'record_locked', status: current },
    })
  }

  const parsed = financialRecordFormSchema.safeParse({
    intervention: '',
    faith_city: '',
    ...body,
  })
  if (!parsed.success) throwValidation(parsed.error)
  const branch = resolveBranch(scope, parsed.data.branch)

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    id,
    {
      ...toFinancialRecordPayload(parsed.data),
      branch,
      updated_at: new Date().toISOString(),
    },
  )
  return { data: { ...updated, id: String((updated as Record<string, unknown>).id) } }
})
