# Hierarchy Flows & Scope Fields — AFC-461a

**Parent:** AFC-461 · **Migration:** `services/directus/schema/migrations/20261020_0002_hierarchy.sql`
**Spec authority:** `docs/planning/data-model-expansion.md` §2, §8.5, §10, §13.

SQL owns the tables; **Directus Flows own the denormalised scope columns**.
There are no opaque DB triggers anywhere in this feature: every derived value
below names the Flow that maintains it, its trigger, and its effect, so a
reviewer can reproduce each write without reading a function body.

## 1. Directus field additions (project config, not SQL)

These collections do not exist as SQL tables in the migration history (or are
Directus system tables), so the migration adds their hierarchy columns only
conditionally (§10 of the migration). The authoritative field list for the
Directus project is:

| Collection | Field | Type | Notes |
| --- | --- | --- | --- |
| `directus_users` | `area` | M2O `areas` | area scope |
| `directus_users` | `zone` | M2O `zones` | single-zone scope |
| `directus_users` | `zone_ids` | JSON array uuid | multi-zone scope, Flow-synced (§4) |
| `attendance_sessions` | `zone` | M2O `zones` | denorm, Flow-maintained (§2) |
| `attendance_sessions` | `bsc` | M2O `bible_study_centres`, nullable | BSC-level service |
| `households` | `zone` | M2O `zones` | denorm, Flow-maintained (§2) |
| `households` | `household_head` | M2O `people` | |

`branch_ids` / `department_ids` on `directus_users` are unchanged (existing).

## 2. Flow `hierarchy.denorm`

| | |
| --- | --- |
| Trigger | `branches`, `bible_study_centres`, `attendance_sessions`, `households` created/updated |
| Effect | `branches.area` ← parent zone's area; `bible_study_centres.zone` ← parent branch's zone; `attendance_sessions.zone` ← session branch's zone; `households.zone` ← household branch's zone |
| Direction | Child reads parent. Never the reverse: a zone edit does not rewrite rows; the next child write picks the mapping up |

The DB suite (`tests/db/70`) pins the invariant each run of this Flow must
preserve: `branch.area = zone.area` and `bsc.zone = parent-branch.zone` on
every row. A Flow edit that breaks it turns the suite red.

## 3. Flow `user.scope_sync`

| | |
| --- | --- |
| Trigger | `directus_users.zone`, `.branch`, or department memberships changed |
| Effect | Recompute `zone_ids` (union of explicit zone + zones of assigned branches) |

`zone_ids` is the only multi-value hierarchy scope the routes read. It is
never hand-edited: the Flow overwrites it on every trigger.

## 4. Enforcement split (read before changing anything)

- **Postgres** states the ceiling: `directus_app` gets SELECT everywhere,
  INSERT/UPDATE on operational columns, **no DELETE** on any hierarchy table,
  and only SELECT on `campus_institutions`. Branch/zone scoping ("own zone",
  "own branch") lives in the Directus policy + the portal route filters, never
  in a GRANT — a GRANT cannot express "own".
- **Portal routes** (`apps/web/server/utils/portal.ts`) repeat the scope in
  the query: `branchCollectionScope` (branches), `zoneScopeFilter` (zone
  denorm collections), `scopeZoneIds` (derive zones from branches when no
  explicit grant), `requireZoneInScope` (403 on an explicitly out-of-scope
  zone). Requested `zone`/`area` values are intersected with the scope
  predicate: out-of-scope yields empty, never foreign rows. A session with no
  branch, no zone, and no area grant is rejected in `getPortalScope`
  (fail-closed, `unscoped_session`).
- **Directus policy** is the only authoritative control (data-model §9). The
  route filters exist so the UI returns the right rows before the policy swap
  and after it; they are not the control.

## 5. Scope matrix (implemented subset of expansion §11)

| Caller | `/api/branches` | `/api/zones` | `/api/bscs` |
| --- | --- | --- | --- |
| Area admin | all | all | all |
| Zone grant | `zone ∈ zone_ids` | `id ∈ zone_ids` | `zone ∈ zone_ids` |
| Branch-only | `id ∈ branch_ids` | zones of own branches | `parent_branch ∈ branch_ids` |
| No scope | 403 `unscoped_session` | 403 `unscoped_session` | 403 `unscoped_session` |

Cross-zone by explicit request → 403 (`zone_out_of_scope` / `branch_out_of_scope`);
cross-zone by filter intersection → empty list. Both are fail-closed; neither
returns a foreign row.
