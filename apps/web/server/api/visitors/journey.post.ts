import { journeyAdvanceSchema } from '@afc/shared'
import {
  getPortalScope,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'
import { advanceJourney } from '../../utils/visitor-journey'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const body = (await readBody(event)) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A visitor id is required',
      data: { code: 'validation_error' },
    })
  }
  const parsed = journeyAdvanceSchema.safeParse({
    to_stage: body.to_stage,
    note: body.note,
    pack_checklist: body.pack_checklist,
    dropoff_outcome: body.dropoff_outcome,
  })
  if (!parsed.success) throwValidation(parsed.error)

  // AFC-583: advanceJourney is the single writer on the 0025 register +
  // the 0008 transition audit — map an unreadable store to the named
  // error, never a bare 500. Deliberate 4xx (order/pack/drop-off gates,
  // validation) pass through untouched.
  // advanceJourney is the single writer: order guard, pack/drop-off gates,
  // entered_at stamp, audit row, visitor update. The SQL trigger repeats the
  // order rule so a Studio edit without review cannot skip a stage either.
  try {
    const result = await advanceJourney(event, scope, {
      visitorId: id,
      toStage: parsed.data.to_stage,
      note: parsed.data.note,
      packChecklist: parsed.data.pack_checklist,
      dropoffOutcome: parsed.data.dropoff_outcome,
    })
    return { data: result }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
})
