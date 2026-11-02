import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  updateItem,
} from '../../../utils/portal'
import { writeOfficeAudit } from '../../../utils/office'

const ALLOWED = new Set(['draft', 'review', 'accepted'])

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')
  await findScopedItem(event, scope, 'office_minutes', id, {
    fields: ['id', 'status'],
    scope: scopeFilter(scope),
  })

  const body = await readBody(event)
  const status = typeof body?.status === 'string' ? body.status.toLowerCase() : ''
  if (!ALLOWED.has(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid status',
      data: {
        code: 'validation_error',
        fields: { status: 'Must be draft, review, or accepted' },
      },
    })
  }

  const now = new Date().toISOString()
  await updateItem(event, scope, 'office_minutes', id, { status, updated_at: now })

  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'updated',
    detail: `Status changed to ${status}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { id, status } }
})
