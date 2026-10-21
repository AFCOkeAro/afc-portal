import type { RegistrationRow } from '../../../../types/portal'
import {
  can,
  csvResponse,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
  visibleFields,
} from '../../../utils/portal'

const FIELDS = [
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

export default defineEventHandler(async (event): Promise<string> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'read')
  requireCan(scope, 'event_registrations', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  // AFC-566: both reads hit 0021 registers. Unreadable store → named
  // error, never a bare 500; deliberate 4xx pass through untouched.
  let eventRow: Record<string, unknown>
  let result: { data: RegistrationRow[] }
  let fields: string[]
  try {
    eventRow = await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: ['id', 'title'],
      scope: eventScopeFilter(scope),
    })

    fields = visibleFields(scope, 'event_registrations', FIELDS)
    result = await listItems<RegistrationRow>(event, scope, 'event_registrations', {
      filter: { event: { _eq: id } },
      fields,
      sort: 'registrant_last_name,registrant_first_name',
      limit: -1,
    })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }

  const medicalVisible =
    can(scope, 'event_registrations', 'read') && fields.includes('medical_notes')
  const headers = [
    'ticket_code',
    'first_name',
    'last_name',
    'email',
    'phone',
    'age_group',
    'branch',
    'guardian_name',
    'guardian_phone',
    'guardian_consent',
    'payment_status',
    'amount_expected',
    'amount_paid',
    'registration_status',
    'source',
    'created_at',
    ...(medicalVisible
      ? [
          'medical_notes',
          'allergies',
          'emergency_contact_name',
          'emergency_contact_phone',
        ]
      : []),
  ]

  const rows: string[][] = [headers]
  for (const registration of result.data) {
    rows.push([
      registration.ticket_code ?? '',
      registration.registrant_first_name,
      registration.registrant_last_name,
      registration.email ?? '',
      registration.phone ?? '',
      registration.age_group ?? '',
      registration.branch ?? '',
      registration.guardian_name ?? '',
      registration.guardian_phone ?? '',
      registration.guardian_consent ? 'yes' : 'no',
      registration.payment_status ?? '',
      registration.amount_expected ?? '',
      registration.amount_paid ?? '',
      registration.registration_status,
      registration.source ?? '',
      registration.created_at ?? '',
      ...(medicalVisible
        ? [
            registration.medical_notes ?? '',
            registration.allergies ?? '',
            registration.emergency_contact_name ?? '',
            registration.emergency_contact_phone ?? '',
          ]
        : []),
    ])
  }

  const slug = String(eventRow.title ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return csvResponse(event, `${slug || 'event'}-registrations.csv`, rows)
})
