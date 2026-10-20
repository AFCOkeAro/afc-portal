# Attendance Flows & Split Contracts — AFC-461c

**Parent:** AFC-461 · **Migration:** `services/directus/schema/migrations/20261020_0003_attendance_counts.sql`
**Spec authority:** `docs/planning/data-model-expansion.md` §3, `docs/planning/prd-expansion.md` §2 (US-A1..A4).

SQL owns the tables; **Directus Flows own the derived totals**. There are no
opaque DB triggers anywhere in this feature: every derived value below names
the Flow that maintains it, its trigger, and its effect, so a reviewer can
reproduce each write without reading a function body.

## 1. Directus field additions (project config, not SQL)

The sessions header belongs to the capture slice that owns the Directus
collection. The only column this slice needs on it is:

| Collection            | Field              | Type                                     | Notes                                |
| --------------------- | ------------------ | ---------------------------------------- | ------------------------------------ |
| `attendance_sessions` | `service_type_def` | M2O `service_type_definitions`, nullable | resolves allowed categories          |
| `attendance_sessions` | `total_headcount`  | integer                                  | Flow-written (§2), never hand-edited |
| `attendance_sessions` | `idempotency_key`  | string, unique                           | retry-safe capture (§3)              |

`zone` / `bsc` on the header landed conditionally in 0002 §10. The
`service_type_def` column lands conditionally in 0003 §2 (added where the host
table exists, skipped loudly where it does not).

## 2. Flow `attendance.total`

|         |                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger | `attendance_counts` created/updated/deleted                                                                                                                                                                   |
| Effect  | `attendance_sessions.total_headcount` ← `SUM(count)` over the session's split rows where at least one split row exists, else the legacy `headcount_total` (historical unsplit rows keep their recorded total) |

The DB suite (`tests/db/71` §§71.3, 71.6) pins the invariant each run of this
Flow must preserve: backfilled rows sum to the legacy five columns, and
male + female rows sum to the session total. A Flow edit that breaks either
turns the suite red.

## 3. Retry-safe capture (US-A1 AC3)

Two uniqueness properties, no code path:

- **Batch replay → upsert no-op.** `UNIQUE (session, category, sex)` (suite
  71 §§71.4–71.5). The client replays the whole batch with
  `INSERT … ON CONFLICT (session, category, sex) DO UPDATE`; a retry leaves
  one row per key with the latest figure.
- **Double submit → refusal, not a twin.** `UNIQUE (idempotency_key)` on the
  session header. The client generates one key per capture attempt and replays
  it; a second submit with the same key collides instead of duplicating the
  session (suite 71 §71.5).

Both properties are database constraints, so they hold regardless of which
route or retry loop performs the write.

## 4. Report & CSV query contract (US-A3, US-A4)

Aggregate by `branch|zone × category × sex × date bucket`, over the
`attendance_sessions` header joined to `attendance_counts`:

- Filters: `group_by` (branch|zone), `session_type`, `date_from`/`date_to`,
  `period` (weekly|monthly|quarterly|yearly|custom). The zod contract is
  `attendanceReportQuerySchema` in `packages/shared`.
- Pagination: page + limit, index-backed (`attendance_counts_session_idx`,
  `attendance_counts_category_idx`, `attendance_sessions_branch_date_idx`).
  Suite 71 §71.8 pins the filter predicates partition fixture rows.
- Permission scope: `getPortalScope`/`scopeFilter` — branch admin own branch
  only, zone grant own zone, area all. A branch export contains only its own
  branch. The HTTP 403/empty half lives in the route layer and is covered
  there, not in SQL.
- CSV columns: branch, zone, service, date, category, male, female, total.
  The CSV streams the same filtered aggregate (chunked cursor, not
  full-buffer); large ranges may use the documented async fallback
  (data-model-expansion §3.5).
- Prior-year compare: a toggle shows current vs prior period side by side (or
  delta) where prior data exists.

## 5. Enforcement split (read before changing anything)

- **Postgres** states the ceiling: `directus_app` gets SELECT on both tables,
  INSERT/UPDATE on operational columns, **no DELETE** on either (attendance
  facts are audited; corrections are UPDATEs). Definitions evolve by status,
  never deletion; `key` is insertable but never updatable.
- **Portal routes** repeat the scope in the query (`scopeFilter`,
  `zoneScopeFilter`, `requireZoneInScope`); out-of-scope yields empty or 403,
  never foreign rows. A session with no scope grant is rejected fail-closed.
- **Directus policy** is the only authoritative control. The route filters
  exist so the UI returns the right rows before the policy swap and after it;
  they are not the control.
