import { marriageCaseLinkSisterSchema } from '@afc/shared'
import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
  updateItem,
} from '../../../utils/portal'
import { officeZoneScope, writeOfficeAudit } from '../../../utils/office'

/**
 * PATCH /api/marriage-cases/:id/link-sister — sister link-in-DB path
 * (AFC-678 phase C). Links the sister person into the case WITHOUT closing
 * it: the stage is untouched and only a `note` trail row is written. Closed
 * files (halted / transferred_out / reported) refuse the link.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = marriageCaseLinkSisterSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
  )
  const stage = String(row.stage)
  if (['halted', 'transferred_out', 'reported'].includes(stage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case cannot link the sister again',
      data: {
        code: 'validation_error',
        fields: { sister_person: 'This file is closed' },
      },
    })
  }

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    {
      sister_person: parsed.data.sister_person,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: stage,
    to_stage: stage,
    event_type: 'note',
    detail: 'Sister linked in-DB; the case stays open',
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
