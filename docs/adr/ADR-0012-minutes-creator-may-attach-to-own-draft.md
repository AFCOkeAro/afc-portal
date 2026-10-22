# ADR-0012: creator-may-attach-to-own-draft on minutes attendees (AFC-701 verdict B)

- Status: accepted (CTO-approved 2026-10-22; see approval comment on AFC-701).
- Signed off: CTO (MediaTech). Input: SecurityEngineer (AFC-702, SHIP WITH FIXES).
- No independent second reviewer exists on this team (recorded degradation);
  approval rests on the SEC review + contract suite 29/29 + CTO re-verification.

## Context

`POST /api/minutes` gates on `office_minutes:create`, but
`POST /api/minutes/:id/attendees` gated on `office_minutes:update`.
A creator without update silently lost the attendee step (every attach 403,
minutes saved with no attendees). Built-in matrix grants no create-only role
(area roles hold ALL on both collections); create-only arises via custom
roles (AFC-669). UX mitigation (AFC-691) warns but cannot complete the flow.

## Decision

Option B, narrow: a caller with `office_minutes:create` may attach attendees
only to their own draft minutes. Implemented in
`apps/web/server/api/minutes/[id].attendees.post.ts` (commit `fbfd320`):

- update-holders: unchanged path.
- Otherwise allow only if: scoped row load (`findScopedItem` + `scopeFilter`)
  succeeds AND `created_by === session user` (strict, NULL denies) AND
  `status === 'draft'` (exact). Else the existing 403 shape.
- F4: `assertUuidParam` before any store read.
- F2: supplied `person` must resolve in-scope; `attendee_user` existence
  verified; malformed uuids 400; unverifiable registry fails closed 503.
- F3: `writeOfficeAudit` on every successful attach (both paths, best-effort).
- No `role-matrix.ts` change, no `minutes_attendees` grant path, no migration.

## Alternatives considered

- Option A (keep update-gate, UX warning only): rejected as the steady state —
  preserves a silent-loss footgun for a legitimate custom-role shape.
  Retained as the fallback if F1–F4 had proven untakeable.
- Attach-within-save (single POST with attendees array): rejected — larger
  contract change to the create route for the same outcome.
- `minutes_attendees:create` grant path: rejected — mints a new capability
  and still needs authorship scoping; the chosen rule reuses the existing
  `office_minutes` dimension.

## Consequences

- Create-only authors can complete their own drafts end-to-end (UX warning on
  the create page becomes informational; `?attendeesFailed` path retained).
- Residual F1: no Directus row policy mirrors the exception yet. The route
  header records: do not enable outside policy-less staging until the policy
  mirrors branch + created_by + draft. Tracked as follow-up (policy-mirror
  migration + parity test).
- Residual F3 naming: audit uses `event_type 'note'` because migration 0013
  CHECK-constrains the column; widening the CHECK needs a CTO-gated migration
  (follow-up).
- Rollback: revert the single route file. Tests: 8 new static contract cases
  in `tests/web/office.contract.mjs` (positive + 4 denial negatives + F2/F3/F4
  + matrix-untouched + payload-unchanged).
