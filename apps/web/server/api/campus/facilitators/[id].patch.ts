import { z } from 'zod'
import { COACHING_FACILITATOR_FIELDS, programmeChildFilter } from '../../../utils/campus'
import {
  findScopedItem,
  getPortalScope,
  mergeFilters,
  requireCan,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const callStatusSchema = z.object({
  call_status: z.enum(['registered', 'called', 'confirmed', 'declined']),
  status: z.enum(['active', 'inactive']).optional(),
})

/**
 * PATCH /api/campus/facilitators/:id — track facilitator call status
 * (US-C1 AC2). Only call/status fields are writable here; the person and
 * programme links are immutable (a re-assignment is a new row). The row
 * must sit under a programme in the caller's visible set.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_facilitators', 'update')

  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A facilitator id is required',
      data: { code: 'validation_error' },
    })
  }

  const parsed = callStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const childFilter = await programmeChildFilter(event, scope)
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_facilitators',
    id,
    {
      fields: COACHING_FACILITATOR_FIELDS,
      scope: mergeFilters(childFilter, undefined) ?? undefined,
    },
  ).catch(() => {
    throw createError({
      statusCode: 404,
      statusMessage: 'That facilitator was not found in your scope',
      data: { code: 'not_found' },
    })
  })

  void row

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_facilitators',
    id,
    {
      call_status: parsed.data.call_status,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      updated_at: new Date().toISOString(),
    },
  )

  return { data: { ...updated, id: String(updated.id ?? id) } }
})
