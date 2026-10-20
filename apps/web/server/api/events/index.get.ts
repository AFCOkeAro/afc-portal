import type { EventRow } from '../../../types/portal'
import {
  branchNames,
  eventScopeFilter,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
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

interface RegistrationCountRow {
  event: string
  registration_status: string
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const eventType =
    typeof query.event_type === 'string' ? query.event_type : undefined
  const status = typeof query.status === 'string' ? query.status : undefined
  const when =
    query.when === 'past' ? 'past' : query.when === 'all' ? 'all' : 'upcoming'
  const now = new Date().toISOString()

  const result = await listItems<EventRow>(event, scope, 'events', {
    filter: mergeFilters(
      when === 'upcoming' ? { start_at: { _gte: now } } : undefined,
      when === 'past' ? { start_at: { _lt: now } } : undefined,
      branch ? { branch: { _eq: branch } } : undefined,
      eventType ? { event_type: { _eq: eventType } } : undefined,
      status ? { status: { _eq: status } } : undefined,
      eventScopeFilter(scope),
    ),
    fields: EVENT_FIELDS,
    sort: when === 'past' ? '-start_at' : 'start_at',
    page,
    limit,
    search: search || undefined,
  })

  const ids = result.data.map((row) => String(row.id))
  const counts = new Map<
    string,
    { registered: number; confirmed: number; attended: number }
  >()
  if (ids.length > 0) {
    const registrations = await listItems<RegistrationCountRow>(
      event,
      scope,
      'event_registrations',
      {
        filter: { event: { _in: ids } },
        fields: ['event', 'registration_status'],
        limit: -1,
      },
    )
    for (const registration of registrations.data) {
      const key = String(registration.event)
      const row = counts.get(key) ?? { registered: 0, confirmed: 0, attended: 0 }
      if (registration.registration_status !== 'cancelled') row.registered += 1
      if (registration.registration_status === 'confirmed') row.confirmed += 1
      if (registration.registration_status === 'attended') row.attended += 1
      counts.set(key, row)
    }
  }

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => {
    const count = counts.get(String(row.id)) ?? {
      registered: 0,
      confirmed: 0,
      attended: 0,
    }
    return {
      ...row,
      id: String(row.id),
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      registered_count: count.registered,
      confirmed_count: count.confirmed,
      attended_count: count.attended,
    }
  })

  return { data: rows, meta: result.meta }
})
