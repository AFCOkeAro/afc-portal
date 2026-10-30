import { minutesFormSchema } from '@afc/shared'
import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeFilter,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/**
 * PATCH /api/minutes/:id — edit minutes (AFC-912).
 *
 * Branch-scoped like the other minutes routes: requireCan enforces the
 * matrix (§11 — writes are area-only) and the scoped load makes a
 * cross-scope id a 404, never a foreign edit. Validation is the same
 * minutesFormSchema as POST, partial so any subset of fields may move.
 * Every edit writes an `updated` row to office_minute_events.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')

  await findScopedItem(event, scope, 'office_minutes', id, {
    fields: ['id'],
    scope: scopeFilter(scope),
  })

  /**
   * Same validation as POST: the shared form schema, partial so any subset of
   * fields may move, with the end-after-start rule restated (the refine lives
   * on the ZodEffects wrapper, so innerType() unwraps to the partial-able
   * object — the attendance capture route uses the same unwrap pattern).
   */
  const minutesPatchSchema = minutesFormSchema
    .innerType()
    .partial()
    .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, {
      message: 'The end time must be after the start time',
      path: ['end_time'],
    })
  const parsed = minutesPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (form.title !== undefined) patch.title = form.title
  if (form.meeting_date !== undefined) patch.meeting_date = form.meeting_date
  if (form.start_time !== undefined) patch.start_time = form.start_time ?? null
  if (form.end_time !== undefined) patch.end_time = form.end_time ?? null
  if (form.location !== undefined) patch.location = form.location ?? null
  if (form.body !== undefined) patch.body = form.body ?? null
  if (form.file !== undefined) patch.file = form.file ?? null
  if (form.branch !== undefined) {
    const branch = resolveBranch(scope, form.branch)
    if (!branch) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A branch is required',
        data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
      })
    }
    patch.branch = branch
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'office_minutes',
    id,
    patch,
  )

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'updated',
    detail: `Minutes edited (${
      Object.keys(patch)
        .filter((key) => key !== 'updated_at')
        .join(', ') || 'no fields'
    })`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...updated, id: String(updated.id) } }
})
