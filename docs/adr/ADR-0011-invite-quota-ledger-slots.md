# ADR-0011 — Atomic invite quota via ledger-slot claim (AFC-516)

**Status:** Accepted · **Date:** 2026-10-20 · **Owner:** CTO (MediaTech) · **Issue:** AFC-516 (parent AFC-464, follow-up of AFC-512)
**Sources:** [data-model-v4](../planning/data-model-v4.md) §3.2 · [prd-addendum-v4](../planning/prd-addendum-v4.md) §3 · wireframes v3 (counter-limit note) · `20261020_0005_event_invites.sql` · `apps/web/server/api/invites/index.post.ts` (F3 gap note)

## Context

AFC-512 landed the invite surface with an honestly recorded F3 gap: the rolling
quota check is count-then-insert, so 20 parallel submits can all read a
below-limit count and all queue past the 10/day limit (TOCTOU). A BEFORE INSERT
trigger on `event_invites` was drafted and reverted: the table is owned by
AFC-480/0005, and a down script that drops the trigger while the referent
survives is exactly the AFC-253 shape the rollback-control gate refuses without
a CTO-signed F3 grandfather entry. Signing the first such entry would normalise
bypassing a gate that currently needs zero entries.

## Decision

Atomic quota by **ledger-slot claim**, owned entirely by a new migration
(`20261020_0016_invite_quota_slots.sql`):

1. New table `invite_quota_slots(inviter_user, period, period_start, slot_no)`,
   PK on all four columns, `CHECK (slot_no >= 0)`. Two grains: `period='day'`
   with `period_start` = Africa/Lagos calendar date, `period='week'` with
   `period_start` = Monday of the Africa/Lagos week. No trigger, no function
   returning trigger, no rule, no constraint on any other table — so the
   rollback-control gate has nothing to reconcile and the grandfather file
   stays at zero entries.
2. Claim protocol (single shared helper, used by the route; the Flow
   `invite.create` spec funnels through the same rule): read member limits
   (D daily, W weekly); INSERT day slots `0..D-1` until one succeeds (unique
   violation → next slot); then INSERT week slots `0..W-1` the same way;
   release the day slot if the week claim fails. Claim success → write the
   invite `queued`/`pending_approval` as today; claim failure → write it
   `blocked_rate_limit` + approval (auditable, consumes no slot). Suppressed
   (STOP) numbers never claim. On invite-write failure after a successful
   claim, best-effort DELETE the claimed slots, then throw.
3. Correctness rests on the PK, not on timing: concurrent writers serialize on
   the unique index; exactly D day-winners and W week-winners exist regardless
   of interleaving. Orphan slots (crash between claim and insert) waste quota
   — the fail-safe direction (blocks more, never queues past the limit).
4. Window semantics move from rolling-24h/7d to Lagos calendar day/week. The
   daily calendar is the specified behaviour (wireframes v3: "Resets at 00:00
   Africa/Lagos"); the rolling implementation was the approximation. The
   weekly calendar (Mon–Sun) is the minimal consistent extension — fixed
   period keys are what make atomic claims possible. `invite_rate_gate()`
   stays unchanged as the UX pre-check; the claim is authoritative.

## Alternatives considered

- **BEFORE INSERT trigger on `event_invites`** — rejected. Correct mechanism,
  wrong ownership: needs an F3 grandfather entry, the first ever, against a
  gate whose value is that it has never needed one. *(Risk lens: a one-entry
  precedent is a one-way door.)*
- **SELECT … FOR UPDATE in a shared txn (option a)** — rejected. The route
  reaches the database only through Directus REST; there is no DB handle to
  hold a transaction, and adding a direct Postgres connection (+ secret,
  + driver) to the web tier is a new dependency and a new privilege surface
  for a problem solvable with the existing REST primitives.
  *(Build vs buy vs integrate; Security & least privilege.)*
- **Single-writer funnel (all writes through one process lock)** — rejected.
  No single-process guarantee exists across web instances and Flows; an
  in-memory mutex would be a correctness claim the deployment cannot keep.

## Consequences

- Migration 0016 grants `directus_app` SELECT + INSERT + DELETE (slot release
  only, own-attempt rows) on the ledger, UPDATE never, no grant touched on any
  sibling table. Rollback refuses while slots exist (audited evidence, 0005
  pattern) and drops only what 0016 created.
- Coder track (delegated, AFC-516 child): migration + down script + suite 74
  + route/helper rework + PGlite concurrency proof (20 parallel claimants,
  exactly D queued) + contract-test updates. Gates (rollback-control,
  privilege, retention-literal, adr-uniqueness) green, zero grandfather
  entries; OTP flag and 503 posture unchanged.
- Tech-debt ledger: weekly window calendarized (was rolling-7d) — revisit only
  if counsel/product require rolling weeks; orphan-slot reconciliation (none —
  waste is fail-safe, no sweeper warranted at this volume).

## Sign-off

- CTO: accepted (this ADR). No F3 grandfather entry authorised — the gate
  stays at zero entries by design, not by exception.
