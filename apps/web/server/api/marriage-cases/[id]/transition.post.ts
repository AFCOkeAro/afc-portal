import {
  MARRIAGE_FLOW_INDEX,
  MARRIAGE_FLOW_STAGES,
  marriageCaseTransitionSchema,
} from '@afc/shared'
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
 * POST /api/marriage-cases/:id/transition — forward stage move
 * (AFC-678 phase C). The DB owns the closed vocabulary; forward order is
 * enforced HERE:
 *
 * - `halted` (reason required) and `transferred_out` (receiving branch
 *   required) close from any stage; every other move must step forward
 *   (to-index > from-index, no skips backward, no jumps over the
 *   zonal/overseer gates).
 * - Entering `announcements_calendar` is allowed only from `attire_check`
 *   (AFC-679 phase D): the attire-check gate cannot be jumped over, so the
 *   announce route's stage floor IS the passed gate.
 * - Leaving `wedding_info` requires the verify checkbox.
 * - Entering `rehearsal`/`wedding` re-checks the 3-day lead.
 *
 * Writes a `stage_changed` (or `halted` / `transferred_out`) trail row.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = marriageCaseTransitionSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

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
      statusMessage: 'A closed case cannot move again',
      data: { code: 'validation_error', fields: { to_stage: 'This file is closed' } },
    })
  }

  const toStage = form.to_stage
  if (toStage !== 'halted' && toStage !== 'transferred_out') {
    const fromIndex = MARRIAGE_FLOW_INDEX[fromStage]
    const toIndex = MARRIAGE_FLOW_INDEX[toStage]
    if (fromIndex === undefined || toIndex === undefined) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Unknown pipeline stage',
        data: { code: 'validation_error', fields: { to_stage: 'Choose a known stage' } },
      })
    }
    if (toIndex <= fromIndex) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The pipeline moves forward only',
        data: {
          code: 'validation_error',
          fields: {
            to_stage: `Move forward from ${fromStage} (next: ${MARRIAGE_FLOW_STAGES[fromIndex + 1] ?? 'reported'})`,
          },
        },
      })
    }
  }

  if (toStage === 'announcements_calendar' && fromStage !== 'attire_check') {
    throw createError({
      statusCode: 400,
      statusMessage: 'The attire check must pass before announcements run',
      data: {
        code: 'validation_error',
        fields: { to_stage: 'Pass the attire check first' },
      },
    })
  }

  if (
    fromStage === 'wedding_info' &&
    toStage !== 'halted' &&
    toStage !== 'transferred_out'
  ) {
    const verified = form.wedding_info_verified ?? row.wedding_info_verified
    if (!verified) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Verify the wedding information before leaving this stage',
        data: {
          code: 'validation_error',
          fields: { wedding_info_verified: 'Tick the verify checkbox' },
        },
      })
    }
  }

  const weddingDate = String(row.wedding_date ?? '')
  const rehearsalDate = String(row.rehearsal_date ?? '')
  if (
    (toStage === 'rehearsal' || toStage === 'wedding') &&
    weddingDate &&
    rehearsalDate
  ) {
    const lead = Date.parse(weddingDate) - Date.parse(rehearsalDate)
    if (!Number.isNaN(lead) && lead < 3 * 24 * 60 * 60 * 1000) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The rehearsal must hold at least 3 days before the wedding',
        data: {
          code: 'validation_error',
          fields: { rehearsal_date: 'Keep 3 days before the wedding' },
        },
      })
    }
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    stage: toStage,
    wedding_info_verified:
      form.wedding_info_verified ?? row.wedding_info_verified ?? false,
    updated_at: now,
  }
  if (toStage === 'halted') patch.halt_reason = form.halt_reason
  if (toStage === 'transferred_out') patch.transfer_to_branch = form.transfer_to_branch

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    patch,
  )

  const eventType =
    toStage === 'halted'
      ? 'halted'
      : toStage === 'transferred_out'
        ? 'transferred_out'
        : 'stage_changed'
  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: fromStage,
    to_stage: toStage,
    event_type: eventType,
    detail:
      toStage === 'halted' ? `Halted: ${form.halt_reason}` : `${fromStage} → ${toStage}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
