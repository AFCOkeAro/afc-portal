/**
 * Time-off working-day helpers (AFC-1058 cutover 0067 over AFC-854).
 *
 * Pure, no I/O: a leave day counts when it falls Monday–Friday. Public
 * holidays are not subtracted here (no holiday register yet — recorded as
 * the phase-2 gap on AFC-854); the count is labelled working days, not
 * net days.
 *
 * SEMANTIC FLAG (D7): this replaces the 0052 7-day count (start..end
 * inclusive over all 7 days, 2adbdbf). Historic stored `days` values and
 * Mon–Fri recomputes differ on any request touching a weekend; used and
 * remaining days compute server-side with this function from the cutover
 * on, and allowances planned against the old counts must be re-checked.
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

/**
 * Role-based leave entitlements (church calendar).
 * Overseer (area/super admin): 8 weeks (56 days)
 * Zonal pastor (zone admin): 4 weeks (28 days)
 * Pastor (branch admin): 2 weeks (14 days)
 */
export const LEAVE_ENTITLEMENTS: Record<string, number> = {
  super_admin: 56,
  area_admin: 56,
  zone_admin: 28,
  branch_admin: 14,
  department_leader: 14,
}

export function leaveEntitlementForRole(role: string): number {
  return LEAVE_ENTITLEMENTS[role] ?? 14
}
