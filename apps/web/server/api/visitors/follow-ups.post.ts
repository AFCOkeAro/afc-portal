import { followUpFormSchema } from '@afc/shared'
import { getPortalScope, throwValidation } from '../../utils/portal'
import { logFollowUp } from '../../utils/visitor-journey'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const body = (await readBody(event)) as Record<string, unknown>
  const visitorId = typeof body.visitor === 'string' ? body.visitor : null
  if (!visitorId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A visitor id is required',
      data: { code: 'validation_error' },
    })
  }
  const parsed = followUpFormSchema.safeParse({
    contact_channel: body.contact_channel,
    outcome: body.outcome,
    contact_at: body.contact_at,
    notes: body.notes,
    next_step: body.next_step,
    next_follow_up_at: body.next_follow_up_at,
    welfare_case: body.welfare_case,
  })
  if (!parsed.success) throwValidation(parsed.error)

  // logFollowUp writes the outcome row, then touches the visitor summary
  // (last_contact_at/channel + next_check_in_at). needs_support tells the UI
  // to offer the welfare-case link.
  const result = await logFollowUp(event, scope, {
    visitorId,
    contactChannel: parsed.data.contact_channel,
    outcome: parsed.data.outcome,
    contactAt: parsed.data.contact_at,
    notes: parsed.data.notes,
    nextStep: parsed.data.next_step,
    nextFollowUpAt: parsed.data.next_follow_up_at,
    welfareCase: parsed.data.welfare_case,
  })
  return { data: result }
})
