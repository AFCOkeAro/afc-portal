/**
 * Pure helpers for the header notification bell (AFC-585).
 *
 * The bell aggregates CLIENT-SIDE from endpoints the session may already
 * load (visitor follow-ups, the celebrations calendar window, latest
 * announcements). Nothing here widens data exposure: each source endpoint
 * enforces its own server-side policy, and the bell only re-displays rows
 * the session could fetch directly.
 *
 * Read state is a per-user `lastSeenAt` ISO timestamp in localStorage (no
 * server state). Kept pure here so the rules are testable without Nuxt.
 */

/** localStorage key holding the per-user last-seen timestamp. */
export function notificationsSeenKey(userId: string): string {
  return `afc:notifications-seen-v1:${userId}`
}

/** Today's date as `YYYY-MM-DD` in local time. */
export function todayKey(from: Date = new Date()): string {
  const year = from.getFullYear()
  const month = String(from.getMonth() + 1).padStart(2, '0')
  const day = String(from.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * A follow-up is overdue when it carries a `next_follow_up_date` strictly
 * before today. Rows with no date are unscheduled, not overdue — they still
 * appear in the Visitors list, just not in the bell.
 */
export function isOverdueFollowUp(
  nextFollowUpDate: string | null | undefined,
  today: string,
): boolean {
  if (!nextFollowUpDate) return false
  return nextFollowUpDate.slice(0, 10) < today
}

/** Latest (max) timestamp in a set; null when the set is empty. */
export function latestTimestamp(
  values: ReadonlyArray<string | null | undefined>,
): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (!value) continue
    if (latest === null || value > latest) latest = value
  }
  return latest
}

/**
 * Whether the bell shows its unread dot: there is at least one item and no
 * recorded sighting, or the newest item is newer than the last sighting.
 */
export function computeUnread(
  itemCount: number,
  latestItemTime: string | null,
  lastSeenAt: string | null,
): boolean {
  if (itemCount === 0) return false
  if (!lastSeenAt) return true
  if (!latestItemTime) return true
  return latestItemTime > lastSeenAt
}
