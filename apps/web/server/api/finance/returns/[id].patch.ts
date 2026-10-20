import {
  findScopedItem,
  getPortalScope,
  requireCan,
  updateItem,
} from '../../../utils/portal'

const TRANSITIONS: Record<string, string> = {
  calculated: 'submitted',
  submitted: 'confirmed',
}

/** Fields the portal never writes: a hand-set computed line is a fabricated liability figure. */
const FABRICATED = [
  'computed_mf',
  'computed_area',
  'computed_savings',
  'computed_intervention',
  'computed_faith_city',
  'total_due',
  'formula_version',
  'computation_status',
]

/**
 * PATCH /api/finance/returns/:id — submit or confirm a computed return.
 *
 * Status-only. `calculated → submitted → confirmed`, stamping
 * `submitted_at` / `confirmed_at` as the trail (Directus activity holds the
 * actor, per prd-expansion line 466). Two refusals:
 * - Submitting a `formula_pending` return is a 409: there is nothing computed
 *   to submit yet, only "pending board formula".
 * - Any body naming a computed field, the total, the version, or the raw
 *   status is a 403: the migration grant already withholds those columns
 *   from the app, and this route refuses to be the way around it.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_returns', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A return id is required' })
  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    id,
    { fields: ['id', 'computation_status'] },
  )
  const current = String(existing.computation_status)

  const body = (await readBody(event)) as Record<string, unknown>

  const fabricated = FABRICATED.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  )
  if (fabricated.length > 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Computed lines are never hand-edited. They arrive from the board formula.',
      data: { code: 'computed_readonly', fields: fabricated },
    })
  }

  if (Object.keys(body).length !== 1 || typeof body.status !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Send only { "status": "submitted" } or { "status": "confirmed" }.',
      data: { code: 'status_only' },
    })
  }

  const next = body.status
  if (current === 'formula_pending') {
    throw createError({
      statusCode: 409,
      statusMessage:
        'This return is pending the board formula, so there is nothing to submit yet.',
      data: { code: 'pending_formula', status: current },
    })
  }
  if (TRANSITIONS[current] !== next) {
    throw createError({
      statusCode: 409,
      statusMessage:
        current === 'confirmed'
          ? 'A confirmed return cannot move again. Correct it with a reviewed step.'
          : `A ${current} return moves to ${TRANSITIONS[current] ?? 'nowhere'} next, not to ${next}.`,
      data: { code: 'invalid_transition', status: current },
    })
  }

  const stampField = next === 'submitted' ? 'submitted_at' : 'confirmed_at'
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'weca_returns',
    id,
    {
      computation_status: next,
      [stampField]: new Date().toISOString(),
    },
  )
  return { data: { ...updated, id: String((updated as Record<string, unknown>).id) } }
})
