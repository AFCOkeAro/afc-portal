import { calendarQuerySchema, combineCalendarFeed } from '@afc/shared'
import type { CalendarItem } from '@afc/shared'
import { getPortalScope, eventScopeFilter, scopeFilter } from '../../utils/portal'
import { logScopedQuery, tryListDomain } from '../../utils/office'

/**
 * GET /api/calendar?date_from=&date_to=&item_type=&scope_type= — unified
 * feed (US-U3 AC1/AC2). Combines sunday_services + events (+event_sessions
 * when the Summit slice lands) + coaching/programmes where present +
 * celebrations from 463e, within the caller's scope, via the single shared
 * `combineCalendarFeed` helper (composition, no duplication). Absent domains
 * contribute zero rows. Every read is scope-logged for audit.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const parsed = calendarQuerySchema.safeParse({
    page: 1,
    limit: 200,
    date_from: getQuery(event).date_from,
    date_to: getQuery(event).date_to,
    item_type: getQuery(event).item_type,
  })
  const filters = parsed.success
    ? parsed.data
    : { date_from: undefined, date_to: undefined, item_type: undefined }
  logScopedQuery(scope, 'calendar.read', { ...filters })

  const [services, events, celebrations] = await Promise.all([
    tryListDomain<Record<string, unknown>>(event, scope, 'sunday_services', {
      filter: { ...scopeFilter(scope) },
      fields: ['id', 'service_date', 'theme', 'branch', 'zone'],
      sort: 'service_date',
    }),
    tryListDomain<Record<string, unknown>>(event, scope, 'events', {
      filter: { ...eventScopeFilter(scope) },
      fields: ['id', 'title', 'start_at', 'branch'],
      sort: 'start_at',
    }),
    tryListDomain<Record<string, unknown>>(event, scope, 'celebrations', {
      filter: { ...scopeFilter(scope) },
      fields: ['id', 'title', 'celebration_date', 'branch', 'zone'],
      sort: 'celebration_date',
    }),
  ])

  const feed = combineCalendarFeed(
    {
      service: services.map((row) => ({
        id: String(row.id),
        item_type: 'service' as const,
        title: String(row.theme ?? 'Sunday service'),
        date: String(row.service_date ?? '').slice(0, 10),
        starts_at: null,
        branch: row.branch ? String(row.branch) : null,
        zone: row.zone ? String(row.zone) : null,
        href: `/services/${String(row.id)}`,
      })),
      event: events.map((row) => ({
        id: String(row.id),
        item_type: 'event' as const,
        title: String(row.title ?? 'Event'),
        date: String(row.start_at ?? '').slice(0, 10),
        starts_at: row.start_at ? String(row.start_at) : null,
        branch: row.branch ? String(row.branch) : null,
        zone: null,
        href: `/events/${String(row.id)}`,
      })),
      celebration: celebrations.map((row) => ({
        id: String(row.id),
        item_type: 'celebration' as const,
        title: String(row.title ?? 'Celebration'),
        date: String(row.celebration_date ?? '').slice(0, 10),
        starts_at: null,
        branch: row.branch ? String(row.branch) : null,
        zone: row.zone ? String(row.zone) : null,
        href: `/celebrations/${String(row.id)}`,
      })),
    },
    { dateFrom: filters.date_from, dateTo: filters.date_to, itemType: filters.item_type },
  )

  const items: CalendarItem[] = feed.filter((item) => item.date.length === 10)
  return { data: items, meta: { total: items.length } }
})
