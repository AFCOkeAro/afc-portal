/** Event id shape guard for public routes (follow-up to the kiosk QA).

Public event lookups filter a Postgres UUID column. A malformed id (wrong
length, non-hex) makes Postgres throw, which the routes previously reported
as 503 "store not readable" — indistinguishable from an outage. Validate
first and fail fast with a 400 that names the input, never the store.
*/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for canonical UUID strings only (any version, any case). */
export function isEventId(value: string): boolean {
  return UUID_RE.test(value)
}
