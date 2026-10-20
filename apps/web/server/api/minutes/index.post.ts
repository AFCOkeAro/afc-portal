import { minutesFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/** POST /api/minutes — record minutes (US-E3 AC2). Matrix §11 grants create to area roles; requireCan enforces it. */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'create')

  const parsed = minutesFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }
  const zones = await scopeZoneIds(event, scope)
  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'office_minutes',
    {
      title: form.title,
      meeting_date: form.meeting_date,
      body: form.body ?? null,
      file: form.file ?? null,
      status: 'draft',
      branch,
      zone: zones[0] ?? null,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: String(created.id),
    event_type: 'created',
    detail: `Minutes recorded: ${form.title}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
