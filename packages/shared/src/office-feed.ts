/**
 * Unified calendar feed helper (AFC-477, prd-expansion §9.5 US-U3).
 *
 * ONE feed helper, owned here, shared by the calendar route and any future
 * consumer (reports, dashboard widgets). Domain slices (463e celebrations,
 * coaching/programmes, services, events) own their tables; this module owns
 * only the combination: a single `CalendarItem` shape, a pure
 * `combineCalendarFeed` that merges pre-scoped domain rows, and the
 * scope-log line the observability lens requires (search/calendar queries
 * logged with scope for audit).
 *
 * The helper never fetches: routes apply their scope predicates first and
 * pass only in-scope rows in. An absent domain (event_sessions deferred in
 * 0013, celebrations before 463e lands, coaching before Slice 5) contributes
 * zero rows -- composition, not duplication, and never a forked table.
 */

export const CALENDAR_ITEM_TYPES = [
  'service',
  'event',
  'programme',
  'celebration',
  'birthday',
  'anniversary',
  'task',
  'meeting',
] as const
export type CalendarItemType = (typeof CALENDAR_ITEM_TYPES)[number]

export interface CalendarItem {
  id: string
  item_type: CalendarItemType
  title: string
  /** ISO date (YYYY-MM-DD) the item belongs to. */
  date: string
  /** ISO timestamp when the domain carries one; null for all-day items. */
  starts_at: string | null
  branch: string | null
  zone: string | null
  /** Deep link the UI opens on click (US-U3 AC2). */
  href: string | null
}

export interface CalendarFeedOptions {
  /** Inclusive lower bound (YYYY-MM-DD); items before it are dropped. */
  dateFrom?: string
  /** Inclusive upper bound (YYYY-MM-DD); items after it are dropped. */
  dateTo?: string
  /** Narrow to one type; omitted means all types. */
  itemType?: CalendarItemType
  /** Cap the merged list; the merge sorts by date before cutting. */
  limit?: number
}

/** Sort key: date, then type order (service, event, programme, celebration, birthday, anniversary, task, meeting). */
const TYPE_ORDER: Record<CalendarItemType, number> = {
  service: 0,
  event: 1,
  programme: 2,
  celebration: 3,
  birthday: 4,
  anniversary: 5,
  task: 6,
  meeting: 7,
}

/**
 * Merge pre-scoped domain rows into one date-ordered feed. Pure: no I/O,
 * no scope decisions -- the caller guarantees every input row is already
 * inside the caller's scope. Filters apply after the merge so a type or
 * date filter cannot change what a domain contributed, only what is shown.
 */
export function combineCalendarFeed(
  parts: Partial<Record<CalendarItemType, CalendarItem[]>>,
  options: CalendarFeedOptions = {},
): CalendarItem[] {
  const merged: CalendarItem[] = [
    ...(parts.service ?? []),
    ...(parts.event ?? []),
    ...(parts.programme ?? []),
    ...(parts.celebration ?? []),
    ...(parts.birthday ?? []),
    ...(parts.anniversary ?? []),
    ...(parts.task ?? []),
    ...(parts.meeting ?? []),
  ]
  const { dateFrom, dateTo, itemType, limit } = options
  return merged
    .filter((item) => (itemType ? item.item_type === itemType : true))
    .filter((item) => (dateFrom ? item.date >= dateFrom : true))
    .filter((item) => (dateTo ? item.date <= dateTo : true))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || TYPE_ORDER[a.item_type] - TYPE_ORDER[b.item_type],
    )
    .slice(0, limit ?? 200)
}

/**
 * Observability line for scoped feed/search queries (architecture lens:
 * observability). The route logs `{ scope: describeScope(...), ... }` with
 * every calendar/search read so an audit can tell who saw what.
 */
export function describeScope(input: {
  role: string
  branchIds: string[]
  zoneIds: string[]
  isArea: boolean
}): string {
  if (input.isArea) return `role=${input.role} scope=area`
  const branches = input.branchIds.length > 0 ? input.branchIds.join(',') : 'none'
  const zones = input.zoneIds.length > 0 ? input.zoneIds.join(',') : 'none'
  return `role=${input.role} branches=${branches} zones=${zones}`
}

/** An item is overdue only when it has a due date and is not terminal. */
export function isTaskOverdue(task: {
  due_date: string | null
  status: string
}): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < new Date().toISOString().slice(0, 10)
}
