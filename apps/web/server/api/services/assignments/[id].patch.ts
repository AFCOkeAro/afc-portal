import { assignmentStatusSchema } from '@afc/shared'
import { directusFetch } from '../../../utils/directus'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
  zoneScopeFilter,
} from '../../../utils/portal'
import { requireDeptScopeForPerson } from '../../../utils/service-assignments'

/**
 * PATCH /api/services/assignments/:id — move a roster row's status.
 *
 * Only `status` (and `notes`) move here; the person and role are the
 * roster's identity and are set once at assign time. The service scoping
 * check runs through the parent service, so a cross-branch assignment id
 * is a 404 exactly like a cross-branch service. Department heads keep the
 * assign-time rule: only their departments' members move. Every move
 * writes the audit row (`status_changed`).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'service_assignments', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'An assignment id is required' })
  }

  const parsed = assignmentStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const assignment = await directusFetch<{
    data: { id: string | number; service: string; person: string; status: string }
  }>(event, `/items/service_assignments/${id}`, {
    accessToken: scope.token,
    query: { fields: 'id,service,person,status' },
  })

  await findScopedItem(event, scope, 'sunday_services', String(assignment.data.service), {
    fields: ['id'],
    scope: scope.isArea
      ? {}
      : scope.zoneIds.length > 0
        ? zoneScopeFilter(scope)
        : { branch: { _in: scope.branchIds } },
  })

  await requireDeptScopeForPerson(event, scope, String(assignment.data.person))

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'service_assignments',
    id,
    {
      status: parsed.data.status,
      notes: parsed.data.notes ?? undefined,
    },
  )

  if (parsed.data.status !== assignment.data.status) {
    const now = new Date().toISOString()
    await createItem(event, scope, 'sunday_service_events', {
      service: String(assignment.data.service),
      event_type: 'status_changed',
      detail: `Roster status moved from ${assignment.data.status} to ${parsed.data.status}`,
      actor_user: scope.session.user.id,
      created_at: now,
    })
  }

  return { data: { ...updated, id: String((updated as { id: unknown }).id) } }
})
