import {
  assertStatusTransitionAllowed,
  validatePaymentPatch,
} from '../../../utils/event-registration-completion'
import type { StaffRegistrationStatus } from '../../../utils/event-registration-completion'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const PATCHABLE_FIELDS = [
  'registration_status',
  'amount_expected',
  'amount_paid',
  'payment_status',
  'payment_reference',
  'audit_note',
] as const

/**
 * Staff status + payment reconciliation (AFC-470 §2–§3).
 *
 * Staff-only (`event_registrations` update grant — branch admin and above;
 * volunteers hold update on check-in fields, and check-in itself lives on
 * the dedicated check-in route, not here). Accepts an allowlisted patch:
 *
 *   registration_status  one legal edge (409 invalid_status_transition)
 *   amount_expected / amount_paid / payment_status / payment_reference
 *   audit_note           optional free text, max 500 chars
 *
 * Audit-note note: `event_registrations` has no per-change audit table in
 * the ratified data-model (only `welfare_case_events` plus the Directus
 * activity log, which already records this PATCH with actor + diff). The
 * note is validated and echoed in the response meta alongside the actor;
 * the durable trail is the activity log. A dedicated registration-events
 * table would be a data-model change for the CTO.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_registrations', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A registration id is required' })

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const unknown = Object.keys(body).filter(
    (key) => !(PATCHABLE_FIELDS as readonly string[]).includes(key),
  )
  if (unknown.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Only ${PATCHABLE_FIELDS.join(', ')} can be patched here`,
      data: { code: 'unpatchable_field', fields: unknown },
    })
  }

  // AFC-566: scope-gates below hit 0021 registers. Unreadable store →
  // named error, never a bare 500; the deliberate 404/409/validation 4xx
  // further down pass through untouched.
  let current: Record<string, unknown>
  try {
    current = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_registrations',
      id,
      { fields: ['id', 'event', 'registration_status', 'payment_status'] },
    )
    // The registration must belong to an event inside the caller's scope —
    // a branch id on the row alone is not enough for area-wide events.
    await findScopedItem(event, scope, 'events', String(current.event), {
      fields: ['id'],
      scope: eventScopeFilter(scope),
    })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }

  const patch: Record<string, unknown> = {}

  if (body.registration_status !== undefined) {
    const from = current.registration_status as StaffRegistrationStatus
    const to = body.registration_status as StaffRegistrationStatus
    assertStatusTransitionAllowed(from, to)
    patch.registration_status = to
  }

  const paymentFields = validatePaymentPatch(body)
  if (Object.keys(paymentFields).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Some payment fields need attention',
      data: { code: 'validation_error', fields: paymentFields },
    })
  }
  for (const key of ['amount_expected', 'amount_paid', 'payment_status'] as const) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  if (body.payment_reference !== undefined) {
    const reference = String(body.payment_reference).trim().slice(0, 120)
    patch.payment_reference = reference === '' ? null : reference
  }

  let auditNote: string | null = null
  if (body.audit_note !== undefined) {
    const note = String(body.audit_note).trim()
    if (note.length > 500) {
      throwValidation({
        issues: [
          { path: ['audit_note'], message: 'Keep the audit note to 500 characters' },
        ],
      })
    }
    auditNote = note === '' ? null : note
  }

  if (Object.keys(patch).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nothing to update: send a status or payment change',
      data: { code: 'empty_patch' },
    })
  }

  try {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'event_registrations',
      id,
      patch,
    )
    return {
      data: { ...updated, id: String(updated.id) },
      meta: {
        actor: scope.session.user.id,
        audit_note: auditNote,
        audit_trail: 'directus_activity',
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
