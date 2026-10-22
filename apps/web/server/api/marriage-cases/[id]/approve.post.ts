import { MARRIAGE_APPROVAL_STAGE, marriageCaseApprovalSchema } from '@afc/shared'
import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
} from '../../../utils/portal'
import { officeZoneScope, writeOfficeAudit } from '../../../utils/office'

/**
 * POST /api/marriage-cases/:id/approve — zonal pastor / Area Overseer gate
 * (AFC-678 phase C). Writes a `marriage_case_events` `approved` row; never
 * moves the stage (the transition route owns forward movement).
 *
 * - `zonal` signs `zonal_review`: caller holds zone_admin, area_admin or
 *   super_admin.
 * - `overseer` signs `overseer_review`: caller holds area_admin or
 *   super_admin.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'read')

  const parsed = marriageCaseApprovalSchema.safeParse(await readBody(event))
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
  const expected = MARRIAGE_APPROVAL_STAGE[parsed.data.gate]
  if (stage !== expected) {
    throw createError({
      statusCode: 400,
      statusMessage: `The ${parsed.data.gate} approval signs ${expected}, not ${stage}`,
      data: { code: 'validation_error', fields: { gate: `This case sits at ${stage}` } },
    })
  }

  const role = scope.role
  if (parsed.data.gate === 'zonal') {
    if (role !== 'zone_admin' && !scope.isArea && role !== 'super_admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'The zonal approval needs the zonal pastor',
        data: { code: 'forbidden' },
      })
    }
  } else {
    if (!scope.isArea && role !== 'super_admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'The overseer approval needs the Area Overseer',
        data: { code: 'forbidden' },
      })
    }
  }

  const now = new Date().toISOString()
  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: stage,
    to_stage: stage,
    event_type: 'approved',
    detail: `${parsed.data.gate} approved at ${stage}${parsed.data.detail ? `: ${parsed.data.detail}` : ''}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { case: id, gate: parsed.data.gate, stage } }
})
