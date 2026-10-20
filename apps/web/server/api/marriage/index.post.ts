import { marriageFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/** POST /api/marriage — record a marriage matter (US-E4 AC2: type, date, status). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_matters', 'create')

  const parsed = marriageFormSchema.safeParse(await readBody(event))
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
    'marriage_matters',
    {
      person: form.person,
      partner_person: form.partner_person ?? null,
      branch,
      zone: form.branch ? null : (zones[0] ?? null),
      matter_type: form.matter_type,
      wedding_date: form.wedding_date ?? null,
      status: 'open',
      notes: form.notes ?? null,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'marriage_matter_events', {
    marriage_matter: String(created.id),
    event_type: 'created',
    detail: `${form.matter_type} recorded`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
