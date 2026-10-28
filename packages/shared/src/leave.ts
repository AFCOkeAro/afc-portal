/**
 * Time-off working-day helpers (AFC-854).
 *
 * Pure, no I/O: a leave day counts when it falls Monday–Friday. Public
 * holidays are not subtracted here (no holiday register yet — recorded as
 * the phase-2 gap on AFC-854); the count is labelled working days, not
 * net days.
 */

function isoToDayNumber(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const time = new Date(`${iso}T12:00:00Z`).getTime()
  if (Number.isNaN(time)) return null
  return Math.floor(time / 86400000)
}

/**
 * Inclusive working-day count between two ISO dates (start..end, weekends
 * skipped). Returns null when either date is invalid or end precedes start.
 */
export function workingDaysBetween(startISO: string, endISO: string): number | null {
  const start = isoToDayNumber(startISO)
  const end = isoToDayNumber(endISO)
  if (start === null || end === null || end < start) return null
  let days = 0
  for (let day = start; day <= end; day += 1) {
    const weekday = new Date(day * 86400000).getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += 1
  }
  return days
}
