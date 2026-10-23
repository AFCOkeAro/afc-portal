/**
 * Canonical Directus create-permission filter for `minutes_attendees`
 * (AFC-704, F1 mirror of the ADR-0012 creator-may-attach-to-own-draft
 * exception enforced by `apps/web/server/api/minutes/[id].attendees.post.ts`).
 *
 * The portal rule lets a caller holding `office_minutes:create` attach
 * attendees only when ALL three hold: the parent minute is inside the
 * caller's branch scope, `created_by` is the caller, and `status` is
 * `draft`. This filter is the same rule as flat Directus JSON, readable
 * without relation metadata (staging's `directus_relations` is empty, so
 * relational `minute.status` filters fail closed -- the `minute_*` columns
 * are denormalised onto the attendee row by migration 0033):
 *
 *   1. branch scope  -> { branch: { _in: $CURRENT_USER.branch_ids } }
 *      (branch/zone ride along via migration 0030's afc_set_scope)
 *   2. authorship    -> { minute_created_by: { _eq: $CURRENT_USER } }
 *      (NULL legacy parents fail closed: NULL never satisfies _eq)
 *   3. draft only    -> { minute_status: { _eq: 'draft' } }
 *
 * Single source of truth: the admin grant endpoint
 * (`admin/roles/[id]/permissions.post.ts`) defaults to this filter for
 * `minutes_attendees:create`, and `tests/web/office.contract.mjs` pins the
 * portal-allow-IFF-policy-allow parity. Do not edit one without the other.
 */

export const MINUTES_ATTENDEE_CREATE_COLLECTION = 'minutes_attendees' as const
export const MINUTES_ATTENDEE_CREATE_ACTION = 'create' as const

export const MINUTES_ATTENDEE_CREATE_FILTER = {
  _and: [
    { branch: { _in: '$CURRENT_USER.branch_ids' } },
    { minute_status: { _eq: 'draft' } },
    { minute_created_by: { _eq: '$CURRENT_USER' } },
  ],
} as const

/** Fresh deep copy so callers can embed the filter without sharing refs. */
export function minutesAttendeeCreateFilter(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(MINUTES_ATTENDEE_CREATE_FILTER)) as Record<
    string,
    unknown
  >
}
