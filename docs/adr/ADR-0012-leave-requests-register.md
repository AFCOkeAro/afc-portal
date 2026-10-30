# ADR-0012 — Time Off leave register: new `leave_requests` collection, not a transfers reuse (AFC-930)

**Status:** Accepted · **Date:** 2026-10-30 · **Owner:** CTO (MediaTech) · **Issue:** AFC-930 (parent AFC-923; follow-up to AFC-926 ruling A)
**Sources:** `20261020_0013_office.sql` · `packages/shared/src/collections.ts` · `packages/shared/src/role-matrix.ts` · AFC-925 (staging `leave_requests`/`leave_balances` with zero policy rows)

## Context

AFC-926 ruling A (human answer A, 2026-10-30): no time-off/leave backing exists
anywhere in the repo — no collection in `collections.ts`, no table in any
migration (office `0013` included), no route, no page, no planning/ADR entry.
AFC-927 (frontend) stays blocked until the backing lands.

AFC-925 independently found `leave_requests` and `leave_balances` tables on
staging with zero `directus_permissions` rows (every non-admin staff gets 403).
Those tables were created outside this migration sequence — no repo migration
owns them. The repo therefore treats staging's tables as unowned state to be
reconciled, not as schema authority.

AFC-923 (parent) fixes the UX split: Requests = requester's own rows,
Approvals = deciding-officer queue, avatars + resolved names, edit of pending
rows. That issue is apps-only and needs this register underneath it.

## Decision

New office-bundle register, following the `0013` office precedent exactly:

1. **Two tables** (migration `20261030_0046_leave_requests.sql` + down script
   refusing while rows exist):
   - `leave_requests` — one row per request: `requester_user` (Directus user,
     required) + nullable `requester_person`, `leave_type`
     (`annual`/`sick`/`compassionate`/`study`/`unpaid`/`other`),
     `start_date`/`end_date` (dates, `CHECK end >= start`), `reason` (required,
     non-blank), `status` (`pending`/`approved`/`rejected`, default `pending`),
     `decided_by` + `decided_at` (set on approve/reject, NULL while pending),
     `branch` required + `zone` denorm (Flow-maintained, `0013` posture —
     a scopeless leave row is invisible fail-closed), timestamps.
   - `leave_request_events` — explicit audit trail (`created`/`updated`/
     `status_changed`/`note`), same shape as `transfer_events`/`task_events`.
     Never silent reliance on the Directus activity log.
2. **Edits** are route rules, not CHECKs: only `pending` rows editable, only by
   the requester (own-row UPDATE); approve/reject transitions set
   `decided_by/decided_at` and write the audit row. A CHECK cannot know the actor.
3. **Grants ceiling** (`directus_app`): SELECT everywhere; INSERT/UPDATE on
   operational columns; NO DELETE on either table (audited ministry facts;
   corrections are UPDATEs, removals are reviewed migrator steps). `reason`
   is a restricted read (deciding officers + area, same posture as
   `tasks.description` / welfare notes): Directus policy withholds, portal
   strips — recorded in `FIELD_RESTRICTIONS`.
4. **Role matrix** (UI contract only; enforcement in Directus policy + routes):
   requester reads/creates own (`volunteer: CR own_branch`, R own via policy);
   `branch_admin: CRU own_branch`; `zone_admin: CRU own_zone`;
   `area_admin`/`super_admin: ALL`; `department_leader`/`none`: none.
   Requests tab = own-row filter; Approvals tab gated on update grant (AFC-923).
5. **Reconcile, don't fork:** migration uses `CREATE TABLE IF NOT EXISTS` +
   conditional FKs under FIXED names (the `0013`/`0003` merge-contract pattern)
   so staging's unowned tables gain the audited definition without collision.
6. **Out of scope:** `leave_balances`/accrual (separate computation slice;
   AFC-925's staging table stays unowned until that slice specs it). No
   Directus policy-row seeding in the migration (AFC-925 owns the
   backfill-vs-Roles-UI decision); this migration only sets the Postgres ceiling.

## Alternatives considered

- **Reuse `transfers` with a leave type** — rejected. *(Architecture lens:*
  wrong abstraction; transfers move home branches with from/to semantics and a
  `branches_differ` constraint. A leave row forced into that shape carries dead
  columns and a meaningless invariant.)*
- **Generic `office_requests` table for leave + future request types** —
  rejected. *(Architecture lens:* premature abstraction; per-domain tables keep
  rollback boundaries clean — the stated `0013` choice. A second request type
  can extract a shared shape when it exists.)*
- **Include `leave_balances` now** — deferred. Accrual rules are unspecced
  (annual entitlement, carry-over, sick certification threshold); shipping a
  balance column without the computation rule invites two writers disagreeing.
  *(Technical debt lens:* tracked, not forgotten — follow-up issue required.)*

## Consequences

- AFC-927 unblocks on merge of the coder subtask output; AFC-923's route work
  has a register to read.
- Staging's unowned `leave_requests` table becomes owned; `leave_balances`
  remains unowned and flagged (follow-up issue).
- `reason` may contain health-adjacent free text → handled as personal data
  (see approval below).

## CTO approval (personal-data gate)

This migration creates tables holding personal data (requester identity, dates,
free-text reason). Per the repo rule the migration requires CTO approval before
apply. **Approved for implementation by CTO (MediaTech) on 2026-10-30** with
one recorded degradation: there is no independent security reviewer on this
team (board declined the seat on cost), so this CTO self-review is not
independent review — same degradation as recorded in `0037`. Mitigations:
no-DELETE ceiling, restricted `reason` read, explicit audit table, and the
SecurityEngineer agent (running) is named reviewer on the implementation
subtask before the migration may apply to staging.
