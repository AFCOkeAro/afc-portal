import { sundayServiceFormSchema } from '@afc/shared'
import {
  assertUuidParam,
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
  updateItem,
  zoneScopeFilter,
} from '../../utils/portal'

/**
 * PATCH /api/services/:id — reschedule / retheme / complete a service.
 *
 * Branch moves resolve against the caller's scope (a branch move outside
 * scope is a 403). A `planned` → `completed` move writes the audit row
 * (`status_changed`); field edits without a status move write nothing, so
 * the trail stays a status history rather than an edit log.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_services', 'update')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'service', 'invalid_service_id')

  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    id,
    {
      fields: ['id', 'branch', 'zone', 'service_date', 'status'],
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const parsed = sundayServiceFormSchema.partial().safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (form.branch !== undefined) {
    const branch = resolveBranch(scope, form.branch)
    if (!branch) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A branch is required: a service with no branch has no scope',
        data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
      })
    }
    patch.branch = branch
  }
  if (form.zone !== undefined) patch.zone = form.zone ?? null
  if (form.service_date !== undefined) patch.service_date = form.service_date
  if (form.service_time !== undefined) patch.service_time = form.service_time ?? null
  if (form.service_type !== undefined) patch.service_type = form.service_type
  if (form.theme !== undefined) patch.theme = form.theme ?? null
  if (form.preacher !== undefined) {
    if (form.preacher) {
      await findScopedItem(event, scope, 'people', form.preacher, { fields: ['id'] })
    }
    patch.preacher = form.preacher ?? null
  }
  if (form.expected_attendance !== undefined)
    patch.expected_attendance = form.expected_attendance ?? null
  if (form.status !== undefined) patch.status = form.status
  if (form.notes !== undefined) patch.notes = form.notes ?? null

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    id,
    patch,
  )

  if (form.status !== undefined && form.status !== existing.status) {
    const now = new Date().toISOString()
    await createItem(event, scope, 'sunday_service_events', {
      service: id,
      event_type: 'status_changed',
      detail: `Status moved from ${String(existing.status)} to ${form.status}`,
      actor_user: scope.session.user.id,
      created_at: now,
    })
  }

  return { data: { ...updated, id: String(updated.id) } }
})
