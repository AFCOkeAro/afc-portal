import { marriageCaseTransferSchema } from '@afc/shared'
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
 * POST /api/marriage-cases/:id/transfer — transfer-out letter flow
 * (AFC-678 phase C). The sister out-of-area closes the file: the stage
 * moves to `transferred_out` with the receiving branch named (the CHECK
 * backstops a crafted request). The letter note is recorded as the
 * `transferred_out` event detail. The sister link-in-DB path (link-sister)
 * keeps the case open instead.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = marriageCaseTransferSchema.safeParse(await readBody(event))
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
  const fromStage = String(row.stage)
  if (['halted', 'transferred_out', 'reported'].includes(fromStage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case cannot transfer again',
      data: {
        code: 'validation_error',
        fields: { transfer_to_branch: 'This file is closed' },
      },
    })
  }

  // The receiving branch may sit outside the caller's scope by design
  // (the sister is out-of-area): no scope rejection here. The CHECK owns
  // the destination requirement and the audit names where the file went.

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    {
      stage: 'transferred_out',
      transfer_to_branch: parsed.data.transfer_to_branch,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: fromStage,
    to_stage: 'transferred_out',
    event_type: 'transferred_out',
    detail: `Transfer-out letter to branch ${parsed.data.transfer_to_branch}${parsed.data.letter_note ? `: ${parsed.data.letter_note}` : ''}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
