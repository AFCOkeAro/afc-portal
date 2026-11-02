import { minutesFormSchema } from '@afc/shared'
import { assertUuidParam, findScopedItem, getPortalScope, requireCan, resolveBranch, scopeFilter, throwValidation, updateItem } from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')

  await findScopedItem(event, scope, 'office_minutes', id, { fields: ['id'], scope: scopeFilter(scope) })

  const parsed = minutesFormSchema.partial?.().safeParse(await readBody(event))
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
      throw createError({ statusCode: 400, statusMessage: 'A branch is required', data: { code: 'validation_error', fields: { branch: 'Choose a branch' } } })
    }
    patch.branch = branch
  }

  const updated = await updateItem<Record<string, unknown>>(event, scope, 'office_minutes', id, patch)

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'updated',
    detail: `Minutes edited (${Object.keys(patch).filter((k) => k !== 'updated_at').join(', ') || 'no fields'})`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...updated, id: String(updated.id) } }
})
