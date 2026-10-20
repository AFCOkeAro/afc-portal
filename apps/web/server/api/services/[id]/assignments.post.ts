import { serviceAssignmentFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  zoneScopeFilter,
} from '../../../utils/portal'
import { requireDeptScopeForPerson } from '../../../utils/service-assignments'

/**
 * POST /api/services/:id/assignments — roster a person into a role.
 *
 * The service id in the path is the service: the body's `service`, when
 * present, must match it rather than fork the roster onto another service.
 * Department heads may only roster members of their own departments
 * (expansion §11: `CRU (assigned dept roles)`) -- anyone else's member is
 * a 403. The assign writes the audit row (`assigned`) in the same request.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'service_assignments', 'create')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A service id is required' })

  const service = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    id,
    {
      fields: ['id', 'branch'],
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const parsed = serviceAssignmentFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  if (form.service !== id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The roster body must name this service',
      data: { code: 'validation_error', fields: { service: 'Must match the service in the path' } },
    })
  }

  await requireDeptScopeForPerson(event, scope, form.person)

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'service_assignments',
    {
      service: id,
      person: form.person,
      role: form.role,
      branch: service.branch ?? null,
      status: form.status,
      notes: form.notes ?? null,
      created_by: scope.session.user.id,
      created_at: now,
    },
  )

  await createItem(event, scope, 'sunday_service_events', {
    service: id,
    event_type: 'assigned',
    detail: `${form.role} assigned (${form.status})`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
