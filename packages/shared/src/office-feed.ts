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
  'marriage',
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

/**
 * Display language for calendar types (AFC-853, Kargul reference). Pastel
 * pill per type with a dark-mode variant; full class strings so Tailwind
 * picks them up at build time (never constructed dynamically). Display
 * only: scope, feeds and links are untouched.
 */
export interface CalendarTypeMeta {
  label: string
  /** Pill: tinted background + readable text, light and dark. */
  pill: string
  /** Solid dot for legends. */
  dot: string
}

export const CALENDAR_TYPE_META: Record<CalendarItemType, CalendarTypeMeta> = {
  service: {
    label: 'Service',
    pill: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200',
    dot: 'bg-purple-500',
  },
  event: {
    label: 'Event',
    pill: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  programme: {
    label: 'Programme',
    pill: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
    dot: 'bg-green-500',
  },
  celebration: {
    label: 'Celebration',
    pill: 'bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200',
    dot: 'bg-pink-500',
  },
  birthday: {
    label: 'Birthday',
    pill: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
  anniversary: {
    label: 'Anniversary',
    pill: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
    dot: 'bg-orange-500',
  },
  task: {
    label: 'Task',
    pill: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200',
    dot: 'bg-cyan-500',
  },
  marriage: {
    label: 'Marriage',
    pill: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200',
    dot: 'bg-teal-500',
  },
}

/** Pill classes for a feed type; unknown types fall back to neutral. */
export function calendarPillClass(itemType: string): string {
  const meta = (CALENDAR_TYPE_META as Record<string, CalendarTypeMeta>)[itemType]
  return meta
    ? meta.pill
    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
}

/** Solid dot classes for a feed type; unknown types fall back to neutral. */
export function calendarDotClass(itemType: string): string {
  const meta = (CALENDAR_TYPE_META as Record<string, CalendarTypeMeta>)[itemType]
  return meta ? meta.dot : 'bg-gray-400'
}

/** Sort key: date, then type order (service, event, programme, celebration, birthday, anniversary, task, marriage). */
const TYPE_ORDER: Record<CalendarItemType, number> = {
  service: 0,
  event: 1,
  programme: 2,
  celebration: 3,
  birthday: 4,
  anniversary: 5,
  task: 6,
  marriage: 7,
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
    ...(parts.marriage ?? []),
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
