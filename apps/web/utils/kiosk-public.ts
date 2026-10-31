/** Public kiosk/badge leaves (AFC-999 / AFC-1003).

Narrow public surface under /events/:id: the kiosk check-in leaf and the
badge print leaf only — never bare /events/ or /events/:id. Both leaves are
fetch-less (kiosk POSTs through the existing grant-gated check-in route with
mode:'kiosk'; badge renders from query params, no roster).

Single home for this regex: the global guard AND the staff parent guard must
agree on exactly which leaves are public, or the kiosk 302s while the badge
200s. Any widening here is a security decision, not a convenience.
*/
export const KIOSK_PUBLIC_RE = /^\/events\/[^/]+\/(kiosk|badge)(\/|$)/

/** True for the two fetch-less public leaves; false for everything else. */
export function isPublicKioskLeaf(path: string): boolean {
  return KIOSK_PUBLIC_RE.test(path)
}
