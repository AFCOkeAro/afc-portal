import { registrationFormSchema } from '@afc/shared'
import {
  STAFF_CREATE_FORBIDDEN_FIELDS,
  toStaffPayload,
} from '../../../utils/event-registration-completion'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  createItem,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../../utils/portal'

/**
 * Staff walk-in / phone registration (AFC-470 §1).
 *
 * Staff-only (`event_registrations` create grant — branch admin and above;
 * volunteers hold update-only so they cannot create). Reuses
 * `registrationFormSchema` for the person fields and stamps the
 * server-owned columns via `toStaffPayload` (`source: 'staff'`).
 *
 * `ticket_code` / `registration_status` from the client are rejected with
 * 400 — the ticket and status are the Flow's to assign, on this path as on
 * the public one. The public allowlist file is untouched.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_registrations', 'create')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  // AFC-566: scope-gate + create below hit 0021 registers. Unreadable
  // store → named error, never a bare 500; deliberate 4xx (scope 404s,
  // forbidden fields, validation) pass through.
  let eventRow: Record<string, unknown>
  try {
    eventRow = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'events',
      id,
      { fields: ['id', 'branch'], scope: eventScopeFilter(scope) },
    )
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  for (const forbidden of STAFF_CREATE_FORBIDDEN_FIELDS) {
    if (body[forbidden] !== undefined) {
      throw createError({
        statusCode: 400,
        statusMessage: `Do not send ${forbidden}: the ticket code and status are assigned by the Flow`,
        data: { code: 'client_forbidden_field', field: forbidden },
      })
    }
  }

  const parsed = registrationFormSchema.safeParse({ ...body, event: id })
  if (!parsed.success) throwValidation(parsed.error)
  const branch = resolveBranch(scope, parsed.data.branch, { allowAreaWide: true })
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_registrations',
      {
        ...toStaffPayload(parsed.data),
        event: id,
        branch: branch ?? eventRow.branch ?? null,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
