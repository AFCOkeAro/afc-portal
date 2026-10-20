import { sundayServiceFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/services — plan a Sunday/midweek/special/camp service.
 *
 * Branch resolves to the caller's own branch for branch staff (resolveBranch
 * defaults it); area staff plan area-wide only by naming a branch, because a
 * service with no branch has no scope and would be invisible fail-closed.
 * Preacher must be a person in scope. The create writes the audit row
 * (sunday_service_events `created`) in the same request -- the portal is the
 * writer, the table is the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_services', 'create')

  const parsed = sundayServiceFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a service with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)
  if (
    !scope.isArea &&
    scope.zoneIds.length === 0 &&
    form.zone &&
    !visibleZones.includes(form.zone)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That zone is outside your scope',
      data: { code: 'zone_out_of_scope' },
    })
  }

  if (form.preacher) {
    await findScopedItem(event, scope, 'people', form.preacher, { fields: ['id'] })
  }

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    {
      branch,
      zone: form.zone ?? null,
      service_date: form.service_date,
      service_time: form.service_time ?? null,
      service_type: form.service_type,
      theme: form.theme ?? null,
      preacher: form.preacher ?? null,
      expected_attendance: form.expected_attendance ?? null,
      status: form.status,
      notes: form.notes ?? null,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )

  // Audit trail is written by the portal, not by the role: the matrix gives
  // area and branch administrators read-only access to service events.
  await createItem(event, scope, 'sunday_service_events', {
    service: String(created.id),
    event_type: 'created',
    detail: `Service planned for ${form.service_date}${form.theme ? ` — ${form.theme}` : ''}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
