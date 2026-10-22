import { marriageCaseScheduleSchema } from '@afc/shared'
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

const CLOSED_STAGES = ['halted', 'transferred_out', 'reported']
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/**
 * PATCH /api/marriage-cases/:id/schedule — set wedding / rehearsal dates
 * (AFC-679 phase D). Moves no stage; the transition route owns movement.
 *
 * The 3-day rehearsal lead is re-checked HERE with the {code, fields}
 * failure shape (the migration-0035 CHECK is the backstop a crafted
 * request cannot skip).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = marriageCaseScheduleSchema.safeParse(await readBody(event))
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
  const stage = String(row.stage)

  if (CLOSED_STAGES.includes(stage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case cannot reschedule',
      data: { code: 'validation_error', fields: { wedding_date: 'This file is closed' } },
    })
  }

  const weddingDate =
    form.wedding_date ?? (row.wedding_date ? String(row.wedding_date) : null)
  const rehearsalDate =
    form.rehearsal_date ?? (row.rehearsal_date ? String(row.rehearsal_date) : null)

  if (weddingDate && rehearsalDate) {
    const lead = Date.parse(weddingDate) - Date.parse(rehearsalDate)
    if (!Number.isNaN(lead) && lead < THREE_DAYS_MS) {
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
  const patch: Record<string, unknown> = { updated_at: now }
  if (form.wedding_date !== undefined) patch.wedding_date = form.wedding_date
  if (form.rehearsal_date !== undefined) patch.rehearsal_date = form.rehearsal_date

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    patch,
  )

  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: stage,
    to_stage: stage,
    event_type: 'note',
    detail: `Schedule set: wedding ${weddingDate ?? 'unset'}, rehearsal ${rehearsalDate ?? 'unset'}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
