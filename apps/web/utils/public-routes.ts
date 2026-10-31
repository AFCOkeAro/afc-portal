/**
 * Shared public-leaf allowlist for the kiosk + badge surface (AFC-1008).
 *
 * Both `middleware/auth.global.ts` (anonymous → /login redirect) and
 * `middleware/staff.ts` (parent `pages/events/[id].vue` staff gate, which
 * Nuxt still runs for child paths) import this single source of truth so
 * the two guards cannot drift.
 *
 * Narrow by design: only the two leaves under /events/:id — `/kiosk` and
 * `/badge` — with an optional trailing slash. Bare `/events`, bare
 * `/events/<id>`, and any nested suffix (`/kiosk/extra`) stay guarded.
 */
export const KIOSK_PUBLIC_RE = /^\/events\/[^/]+\/(kiosk|badge)\/?$/

export function isKioskBadgePublicLeaf(path: string): boolean {
  return KIOSK_PUBLIC_RE.test(path)
}
