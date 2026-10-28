/**
 * Pure date helpers for the calendar views (AFC-575).
 *
 * ONE copy of the range maths, owned here and auto-imported by Nuxt, shared
 * by the staff calendar, the public calendar and the CalendarViews renderer:
 * the fetch window (`rangeForView`) and the rendered grid always agree, so a
 * view cannot show a day its feed never requested. All arithmetic is local
 * time on calendar dates (no timestamps), so there is no UTC-shift day
 * off-by-one. Weeks start on Monday.
 */

export type CalendarView = 'year' | 'month' | 'week' | 'day' | 'list'

export const CALENDAR_VIEWS: CalendarView[] = ['year', 'month', 'week', 'day', 'list']

/**
 * One calendar row as the CalendarViews renderer receives it. Both feeds
 * (staff `CalendarItem` and the stripped public item) map onto this shape;
 * `href` decides the row policy — a link when present, plain text when null.
 */
export interface CalendarViewItem {
  id: string
  item_type: string
  title: string
  date: string
  starts_at?: string | null
  branch_name?: string | null
  branch?: string | null
  href?: string | null
}

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === 'string' && (CALENDAR_VIEWS as string[]).includes(value)
}

export function isISODate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

export function todayISO(): string {
  return formatISO(new Date())
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso)
  date.setDate(date.getDate() + days)
  return formatISO(date)
}

export function addMonthsISO(iso: string, months: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  const target = new Date(y, m - 1 + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d, lastDay))
  return formatISO(target)
}

export function addYearsISO(iso: string, years: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  const lastDay = new Date(y + years, m, 0).getDate()
  return formatISO(new Date(y + years, m - 1, Math.min(d, lastDay)))
}

/** Monday of the week containing `iso` (weeks start on Monday). */
export function startOfWeekISO(iso: string): string {
  const date = parseISODate(iso)
  const dow = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - dow)
  return formatISO(date)
}

/**
 * Fetch window for a view: the feed is paged with date_from/date_to set to
 * this range (cap 200 server-side, unchanged). The month window is padded to
 * full Monday–Sunday grid weeks so adjacent-month cells render their items.
 */
export function rangeForView(
  view: CalendarView,
  focused: string,
): { from: string; to: string } {
  const [y = 0, m = 1] = focused.split('-').map(Number)
  switch (view) {
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'month': {
      const first = `${y}-${pad(m)}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const last = `${y}-${pad(m)}-${pad(lastDay)}`
      return { from: startOfWeekISO(first), to: addDaysISO(startOfWeekISO(last), 6) }
    }
    case 'week': {
      const monday = startOfWeekISO(focused)
      return { from: monday, to: addDaysISO(monday, 6) }
    }
    case 'day':
      return { from: focused, to: focused }
    case 'list':
      return { from: focused, to: addDaysISO(focused, 30) }
  }
}

/** Move the focused date one step back/forward in the current view's unit. */
export function shiftFocused(view: CalendarView, focused: string, dir: -1 | 1): string {
  switch (view) {
    case 'year':
      return addYearsISO(focused, dir)
    case 'month':
      return addMonthsISO(focused, dir)
    case 'week':
      return addDaysISO(focused, dir * 7)
    case 'day':
      return addDaysISO(focused, dir)
    case 'list':
      return addDaysISO(focused, dir * 30)
  }
}

/** Monday-first grid weeks covering the month containing `focused`. */
export function monthGrid(focused: string): string[][] {
  const { from, to } = rangeForView('month', focused)
  const weeks: string[][] = []
  let cursor = from
  while (cursor <= to) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor)
      cursor = addDaysISO(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** The seven Monday–Sunday dates of the week containing `focused`. */
export function weekDays(focused: string): string[] {
  const monday = startOfWeekISO(focused)
  return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
}

/** First-of-month dates for the twelve months of the year of `focused`. */
export function yearMonths(focused: string): string[] {
  const y = focused.slice(0, 4)
  return Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}-01`)
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function monthTitle(focused: string): string {
  const [y = 0, m = 1] = focused.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

export function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10))
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/**
 * Count feed items per calendar type (AFC-865). Pure helper for the
 * colour legend and the Year mini-month counts: when `prefix` (a
 * `YYYY-MM` month prefix) is given, only items in that month count.
 * Unknown types are ignored so a future feed type cannot break the grid.
 */
export function countByType(
  items: Pick<CalendarViewItem, 'item_type' | 'date'>[],
  prefix?: string,
): Record<string, number> {
  const counts: Record<string, number> = {
    service: 0,
    event: 0,
    programme: 0,
    celebration: 0,
  }
  for (const item of items) {
    if (prefix && !item.date.startsWith(prefix)) continue
    if (item.item_type in counts) counts[item.item_type] = (counts[item.item_type] ?? 0) + 1
  }
  return counts
}
