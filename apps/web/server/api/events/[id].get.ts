import type { EventDetail, RegistrationRow } from '../../../types/portal'
import {
  branchNames,
  can,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
  visibleFields,
} from '../../utils/portal'

const EVENT_FIELDS = [
  'id',
  'title',
  'slug',
  'summary',
  'event_type',
  'branch',
  'start_at',
  'end_at',
  'location',
  'address',
  'capacity',
  'waitlist_enabled',
  'registration_open',
  'registration_opens_at',
  'registration_closes_at',
  'fee_amount',
  'currency',
  'requires_guardian_consent',
  'collect_medical',
  'age_min',
  'age_max',
  'visibility',
  'status',
]

const REGISTRATION_FIELDS = [
  'id',
  'event',
  'person',
  'registrant_first_name',
  'registrant_last_name',
  'email',
  'phone',
  'date_of_birth',
  'age_group',
  'branch',
  'guardian_name',
  'guardian_phone',
  'guardian_email',
  'guardian_consent',
  'consent_signed_at',
  'medical_notes',
  'allergies',
  'emergency_contact_name',
  'emergency_contact_phone',
  'amount_expected',
  'amount_paid',
  'payment_status',
  'payment_reference',
  'ticket_code',
  'registration_status',
  'source',
  'created_at',
]

export default defineEventHandler(async (event): Promise<EventDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const row = await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
    fields: EVENT_FIELDS,
    scope: eventScopeFilter(scope),
  })
  const names = await branchNames(event, scope)

  let registrations: RegistrationRow[] = []
  if (can(scope, 'event_registrations', 'read')) {
    const result = await listItems<RegistrationRow>(
      event,
      scope,
      'event_registrations',
      {
        filter: { event: { _eq: id } },
        fields: visibleFields(scope, 'event_registrations', REGISTRATION_FIELDS),
        sort: 'registrant_last_name,registrant_first_name',
        limit: -1,
      },
    )
    registrations = stripHiddenMany(
      scope,
      'event_registrations',
      result.data as unknown as Record<string, unknown>[],
    ).map((registration) => {
      const typed = registration as unknown as RegistrationRow
      return {
        ...typed,
        id: String(typed.id),
        person_name:
          [typed.registrant_first_name, typed.registrant_last_name]
            .filter(Boolean)
            .join(' ') || null,
      }
    })
  }

  const active = registrations.filter(
    (registration) => registration.registration_status !== 'cancelled',
  )

  return {
    ...(row as unknown as EventDetail),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    registered_count: active.length,
    confirmed_count: active.filter(
      (registration) => registration.registration_status === 'confirmed',
    ).length,
    attended_count: active.filter(
      (registration) => registration.registration_status === 'attended',
    ).length,
    registrations,
  }
})
