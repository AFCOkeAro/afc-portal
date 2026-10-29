import { calendarQuerySchema, combineCalendarFeed } from '@afc/shared'
import type { CalendarItem } from '@afc/shared'
import { getPortalScope, eventScopeFilter, scopeFilter } from '../../utils/portal'
import { logScopedQuery, tryListDomain } from '../../utils/office'

/**
 * Map one-off celebration rows to feed items, splitting the register type
 * into checklist categories: birthday / anniversary stay toggleable on
 * their own; every other celebration type keeps the celebration bucket.
 */
function celebrationTypeOf(type: unknown): 'birthday' | 'anniversary' | 'celebration' {
  if (type === 'birthday') return 'birthday'
  if (type === 'wedding_anniversary') return 'anniversary'
  return 'celebration'
}

/**
 * Project recurring month/day greetings into a bounded window (AFC-879).
 * The register stores the original date (often decades past); without
 * projection a birthday never appears in the viewed month. Feb 29 skips
 * non-leap years by design. Capped so an unbounded query cannot fan out.
 */
const MAX_RECURRENCE = 400

function recurringDates(month: number, day: number, from: string, to: string): string[] {
  const out: string[] = []
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || toYear < fromYear)
    return out
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  for (let year = fromYear; year <= toYear && out.length < MAX_RECURRENCE; year += 1) {
    if (
      month === 2 &&
      day === 29 &&
      !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
    )
      continue
    const iso = `${year}-${mm}-${dd}`
    if (iso >= from && iso <= to) out.push(iso)
  }
  return out
}

/**
 * GET /api/calendar?date_from=&date_to=&item_type=&scope_type= — unified
 * feed (US-U3 AC1/AC2). Combines sunday_services + events (+event_sessions
 * when the Summit slice lands) + coaching/programmes where present +
 * celebrations from 463e + birthdays/anniversaries (recurring celebration
 * rows projected into the window, AFC-879) + open tasks by due date +
 * marriage wedding dates, within the caller's scope, via the single shared
 * `combineCalendarFeed` helper (composition, no duplication). Absent domains
 * contribute zero rows. Every read is scope-logged for audit.
 *
 * Privacy: celebration rows carry staff-written titles only — no DOB, age,
 * or birth year ever enters the payload. Birthday/anniversary items are
 * the greeting, not the underlying date of birth.
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

  const [services, events, celebrations, tasks, marriages] = await Promise.all([
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
      fields: ['id', 'type', 'title', 'event_date', 'is_recurring', 'branch', 'zone'],
      sort: 'event_date',
      limit: 500,
    }),
    tryListDomain<Record<string, unknown>>(event, scope, 'tasks', {
      filter: {
        ...scopeFilter(scope),
        due_date: { _nnull: true },
        status: { _nin: ['done', 'cancelled'] },
      },
      fields: ['id', 'title', 'due_date', 'status', 'branch', 'zone'],
      sort: 'due_date',
      limit: 200,
    }),
    tryListDomain<Record<string, unknown>>(event, scope, 'marriage_cases', {
      filter: { ...scopeFilter(scope), wedding_date: { _nnull: true } },
      fields: ['id', 'brother_person', 'sister_person', 'wedding_date', 'branch', 'zone'],
      sort: 'wedding_date',
      limit: 200,
    }),
  ])

  // Window for recurrence projection. The page always sends the visible
  // range; default to the current month when it does not.
  const today = new Date().toISOString().slice(0, 10)
  const from = filters.date_from ?? `${today.slice(0, 7)}-01`
  const to = filters.date_to ?? today.slice(0, 7) + '-31'

  const dated: CalendarItem[] = []
  const undated: CalendarItem[] = []
  for (const row of celebrations) {
    const raw = String(row.event_date ?? '')
    const kind = celebrationTypeOf(row.type)
    const title = String(
      row.title ??
        (kind === 'birthday'
          ? 'Birthday'
          : kind === 'anniversary'
            ? 'Anniversary'
            : 'Celebration'),
    )
    const base = {
      branch: row.branch ? String(row.branch) : null,
      zone: row.zone ? String(row.zone) : null,
      href: null,
      starts_at: null,
    } as const
    if (row.is_recurring) {
      const month = Number(raw.slice(5, 7))
      const day = Number(raw.slice(8, 10))
      if (!Number.isFinite(month) || !Number.isFinite(day)) continue
      for (const iso of recurringDates(month, day, from, to)) {
        dated.push({
          id: `${String(row.id)}@${iso}`,
          item_type: kind,
          title,
          date: iso,
          ...base,
        })
      }
    } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      undated.push({
        id: String(row.id),
        item_type: kind,
        title,
        date: raw.slice(0, 10),
        ...base,
      })
    }
  }

  // Couple names for marriage items, one batched read (display only).
  const personIds = [
    ...new Set(
      marriages
        .flatMap((row) => [row.brother_person, row.sister_person])
        .filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ]
  let names = new Map<string, string>()
  if (personIds.length > 0) {
    const people = await tryListDomain<Record<string, unknown>>(event, scope, 'people', {
      filter: { id: { _in: personIds } },
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      limit: personIds.length,
    })
    names = new Map(
      people.map((row) => [
        String(row.id),
        String(
          row.preferred_name ||
            [row.first_name, row.last_name].filter(Boolean).join(' ') ||
            'Marriage',
        ),
      ]),
    )
  }

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
      celebration: [...undated, ...dated].filter(
        (item) => item.item_type === 'celebration',
      ),
      birthday: [...undated, ...dated].filter((item) => item.item_type === 'birthday'),
      anniversary: [...undated, ...dated].filter(
        (item) => item.item_type === 'anniversary',
      ),
      task: tasks
        .map((row) => {
          const date = String(row.due_date ?? '').slice(0, 10)
          if (date.length !== 10) return null
          const status = String(row.status ?? '')
          return {
            id: String(row.id),
            item_type: 'task' as const,
            title: `${String(row.title ?? 'Task')} (${status.replace(/_/g, ' ')})`,
            date,
            starts_at: null,
            branch: row.branch ? String(row.branch) : null,
            zone: row.zone ? String(row.zone) : null,
            href: `/tasks/${String(row.id)}`,
          }
        })
        .filter((item) => item !== null),
      marriage: marriages
        .map((row) => {
          const date = String(row.wedding_date ?? '').slice(0, 10)
          if (date.length !== 10) return null
          const a =
            typeof row.brother_person === 'string'
              ? (names.get(row.brother_person) ?? null)
              : null
          const b =
            typeof row.sister_person === 'string'
              ? (names.get(row.sister_person) ?? null)
              : null
          return {
            id: String(row.id),
            item_type: 'marriage' as const,
            title: a && b ? `${a} & ${b} wedding` : 'Marriage',
            date,
            starts_at: null,
            branch: row.branch ? String(row.branch) : null,
            zone: row.zone ? String(row.zone) : null,
            href: `/marriage-cases/${String(row.id)}`,
          }
        })
        .filter((item) => item !== null),
    },
    { dateFrom: filters.date_from, dateTo: filters.date_to, itemType: filters.item_type },
  )

  const items: CalendarItem[] = feed.filter((item) => item.date.length === 10)
  return { data: items, meta: { total: items.length } }
})
