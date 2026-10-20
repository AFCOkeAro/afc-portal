import { announcementStatusSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { announcementScope, writeOfficeAudit } from '../../utils/office'

/**
 * PATCH /api/announcements/:id { status } — build-up move with approval
 * (US-E3 AC3). `published` stamps approved_by; every move writes the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'announcements', 'update')

  const parsed = announcementStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const id = String(getRouterParam(event, 'id'))
  await findScopedItem(event, scope, 'announcements', id, {
    scope: announcementScope(scope),
  })

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'announcements',
    id,
    {
      status: parsed.data.status,
      approved_by: parsed.data.status === 'published' ? scope.session.user.id : undefined,
      updated_at: now,
    },
  )

  await writeOfficeAudit(event, scope, 'announcement_events', {
    announcement: id,
    event_type: parsed.data.status === 'published' ? 'approved' : 'status_changed',
    detail: `Status → ${parsed.data.status}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
