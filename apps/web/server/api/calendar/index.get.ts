import { calendarQuerySchema, combineCalendarFeed } from '@afc/shared'
import type { CalendarItem } from '@afc/shared'
import {
  getPortalScope,
  eventScopeFilter,
  scopeFilter,
  isHidden,
} from '../../utils/portal'
import { logScopedQuery, tryListDomain, officeBranchScope } from '../../utils/office'

/**
 * GET /api/calendar?date_from=&date_to=&item_type=&scope_type= — unified
 * feed (US-U3 AC1/AC2). Combines sunday_services + events (+event_sessions
 * when the Summit slice lands) + coaching/programmes where present +
 * celebrations from 463e + member dates (AFC-879: birthdays from people DOB
 * month/day, wedding anniversaries from households.wedding_date) + task due
 * dates + office-minutes meetings, within the caller's scope, via the single
 * shared `combineCalendarFeed` helper (composition, no duplication). Absent
 * domains contribute zero rows. Every read is scope-logged for audit.
 *
 * PRIVACY (AFC-879, NDPA s.40(2) — the portal holds children's records):
 * - Birthdays project ONE occurrence per year inside the window from the
 *   DOB month/day only. The response carries no birth year, no age, and no
 *   DOB value — only the occurrence date and the member's name.
 * - The DOB column is restricted (role-matrix FIELD_RESTRICTIONS: visible
 *   to super_admin, area_admin, branch_admin only). Roles without the
 *   grant contribute ZERO birthday rows: the route never requests the
 *   column for them, so a feed-adjacent read cannot leak what the matrix
 *   withholds. Fail closed, never filtered afterwards.
 * - Anniversaries project households.wedding_date month/day the same way;
 *   wedding_date is not a restricted field, so every role with a
 *   households read grant sees them in scope.
 * - Tasks show open items only (done/cancelled due dates are history, not
 *   calendar). Descriptions are never read here (restricted to assignee +
 *   scoped admin), so the feed cannot leak them.
 * - Marriage-case wedding dates are deliberately NOT read here: the
 *   announce step already writes the wedding (+ rehearsal) as events, so
 *   reading the case row too would double-count the same wedding.
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

  // DOB is a restricted field: only request it for roles the matrix grants
  // it to. Everyone else contributes zero birthday rows (fail closed).
  const mayReadDob = !isHidden(scope, 'people', 'date_of_birth')

  const [services, events, celebrations, people, households, tasks, minutes] =
    await Promise.all([
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
        fields: ['id', 'title', 'event_date', 'branch', 'zone'],
        sort: 'event_date',
      }),
      mayReadDob
        ? tryListDomain<Record<string, unknown>>(event, scope, 'people', {
            filter: { ...scopeFilter(scope) },
            fields: [
              'id',
              'first_name',
              'last_name',
              'preferred_name',
              'date_of_birth',
              'branch',
            ],
            sort: 'first_name',
          })
        : Promise.resolve([] as Record<string, unknown>[]),
      tryListDomain<Record<string, unknown>>(event, scope, 'households', {
        filter: { ...scopeFilter(scope) },
        fields: ['id', 'name', 'wedding_date', 'branch'],
        sort: 'name',
      }),
      tryListDomain<Record<string, unknown>>(event, scope, 'tasks', {
        filter: {
          ...officeBranchScope(scope),
          status: { _nin: ['done', 'cancelled'] },
        },
        fields: ['id', 'title', 'due_date', 'status', 'branch'],
        sort: 'due_date',
      }),
      tryListDomain<Record<string, unknown>>(event, scope, 'office_minutes', {
        filter: { ...officeBranchScope(scope) },
        fields: ['id', 'title', 'meeting_date', 'branch'],
        sort: 'meeting_date',
      }),
    ])

  const from = filters.date_from ?? '0000-01-01'
  const to = filters.date_to ?? '9999-12-31'

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
        date: String(row.event_date ?? '').slice(0, 10),
        starts_at: null,
        branch: row.branch ? String(row.branch) : null,
        zone: row.zone ? String(row.zone) : null,
        href: `/celebrations/${String(row.id)}`,
      })),
      birthday: people.flatMap((row) =>
        occurrencesInWindow(String(row.date_of_birth ?? ''), from, to).map((date) => ({
          id: String(row.id),
          item_type: 'birthday' as const,
          title: `${personDisplayName(row)}'s birthday`,
          date,
          starts_at: null,
          branch: row.branch ? String(row.branch) : null,
          zone: null,
          href: `/people/${String(row.id)}`,
        })),
      ),
      anniversary: households.flatMap((row) =>
        occurrencesInWindow(String(row.wedding_date ?? ''), from, to).map((date) => ({
          id: String(row.id),
          item_type: 'anniversary' as const,
          title: `${String(row.name ?? 'Household')} anniversary`,
          date,
          starts_at: null,
          branch: row.branch ? String(row.branch) : null,
          zone: null,
          href: `/households/${String(row.id)}`,
        })),
      ),
      task: tasks
        .filter((row) => String(row.due_date ?? '').length >= 10)
        .map((row) => ({
          id: String(row.id),
          item_type: 'task' as const,
          title: String(row.title ?? 'Task'),
          date: String(row.due_date ?? '').slice(0, 10),
          starts_at: null,
          branch: row.branch ? String(row.branch) : null,
          zone: null,
          href: `/tasks/${String(row.id)}`,
        })),
      meeting: minutes
        .filter((row) => String(row.meeting_date ?? '').length >= 10)
        .map((row) => ({
          id: String(row.id),
          item_type: 'meeting' as const,
          title: String(row.title ?? 'Meeting'),
          date: String(row.meeting_date ?? '').slice(0, 10),
          starts_at: null,
          branch: row.branch ? String(row.branch) : null,
          zone: null,
          href: `/minutes/${String(row.id)}`,
        })),
    },
    { dateFrom: filters.date_from, dateTo: filters.date_to, itemType: filters.item_type },
  )

  const items: CalendarItem[] = feed.filter((item) => item.date.length === 10)
  return { data: items, meta: { total: items.length } }
})

function personDisplayName(row: Record<string, unknown>): string {
  const preferred =
    typeof row.preferred_name === 'string' ? row.preferred_name.trim() : ''
  const first = typeof row.first_name === 'string' ? row.first_name.trim() : ''
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  const base = [first, last].filter(Boolean).join(' ')
  return preferred || base || 'Member'
}

/**
 * Project the month/day of an ISO date column onto every year inside the
 * [from, to] window (birthdays, wedding anniversaries). Only the month/day
 * is ever used — the source year never reaches the response. Feb 29
 * anniversaries/birthdays are skipped in non-leap years (there is no
 * occurrence to show); leap years keep them.
 */
export function occurrencesInWindow(isoDate: string, from: string, to: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return []
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return []
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear)
    return []
  const out: string[] = []
  const pad = (n: number): string => String(n).padStart(2, '0')
  for (let year = fromYear; year <= toYear; year += 1) {
    // Skip impossible dates (Feb 29 outside leap years, Feb 30, ...).
    const probe = new Date(Date.UTC(year, month - 1, day))
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      continue
    }
    const occurrence = `${year}-${pad(month)}-${pad(day)}`
    if (occurrence >= from && occurrence <= to) out.push(occurrence)
  }
  return out
}
