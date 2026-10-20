import { announcementFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/** POST /api/announcements — draft an announcement (US-E3 AC3: draft → scheduled → published + approval). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'announcements', 'create')

  const parsed = announcementFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // Null branch is an area-wide announcement; only area staff may leave it unset.
  const branch = form.branch ?? (scope.isArea ? null : resolveBranch(scope, undefined))
  if (form.branch && !scope.isArea && !scope.branchIds.includes(form.branch)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That branch is outside your scope',
      data: { code: 'branch_out_of_scope' },
    })
  }
  const zones = await scopeZoneIds(event, scope)
  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'announcements',
    {
      title: form.title,
      body: form.body ?? null,
      publish_from: form.publish_from ?? null,
      publish_to: form.publish_to ?? null,
      channels: form.channels,
      audience: form.audience,
      status: 'draft',
      branch,
      zone: zones[0] ?? null,
      created_by: scope.session.user.id,
      approved_by: null,
      created_at: now,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'announcement_events', {
    announcement: String(created.id),
    event_type: 'created',
    detail: `Draft created: ${form.title}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
