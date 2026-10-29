import type { BlessingRow, EventDetail, RegistrationRow } from '../../../types/portal'
import {
  branchNames,
  can,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
  throwStoreUnavailable,
  visibleFields,
  zoneScopeFilter,
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
  'payments_enabled',
  'requires_guardian_consent',
  'collect_medical',
  'age_min',
  'age_max',
  'visibility',
  'status',
  'registration_visibility',
  'speakers_visibility',
  'resources_visibility',
  'schedule_visibility',
  'speakers',
  'resources',
  'schedule',
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

const BLESSING_FIELDS = [
  'id',
  'blessing_type',
  'other_label',
  'count',
  'total_count',
  'branch',
  'service_date',
  'sunday_service',
  'event',
  'created_at',
]

export default defineEventHandler(async (event): Promise<EventDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  // AFC-566: core reads hit 0021 collections — map an unreadable store
  // to the named error, never a bare 500. Deliberate 4xx (scope 404s) pass
  // through; the blessings enrichment (0011 store) stays outside the try.
  let row: Record<string, unknown>
  let registrations: RegistrationRow[] = []
  try {
    row = await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: EVENT_FIELDS,
      scope: eventScopeFilter(scope),
    })

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
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
  const names = await branchNames(event, scope)

  const active = registrations.filter(
    (registration) => registration.registration_status !== 'cancelled',
  )

  // US-E1 blessings surface: blessings recorded against this event appear
  // on the event page, with counts linking to the underlying records.
  // Gated on blessings:read; the event scope bounds the read, and the
  // branch/zone predicate below keeps a cross-branch blessing recorded
  // against a shared event out of a narrower session (fail-closed).
  let blessings: BlessingRow[] = []
  if (can(scope, 'blessings', 'read')) {
    const linked = await listItems<BlessingRow>(event, scope, 'blessings', {
      filter: mergeFilters(
        { event: { _eq: id } },
        scope.isArea
          ? undefined
          : scope.zoneIds.length > 0
            ? zoneScopeFilter(scope)
            : scopeFilter(scope),
      ),
      fields: BLESSING_FIELDS,
      sort: 'blessing_type,service_date',
      limit: -1,
    })
    blessings = linked.data.map((row) => ({
      ...row,
      id: String(row.id),
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      zone_name: null,
    }))
  }

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
    blessings,
    blessings_total: blessings.reduce(
      (sum, row) => sum + Number(row.count ?? row.total_count ?? 0),
      0,
    ),
  }
})
