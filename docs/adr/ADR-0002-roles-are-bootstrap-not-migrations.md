# ADR-0002 — Roles are provisioned by bootstrap, never by a migration

**Status:** Accepted (implementation), CTO 2026-10-06 — second review pending the
SecurityEngineer seat ([AFC-166](/AFC/issues/AFC-166),
[AFC-168](/AFC/issues/AFC-168))
**Supersedes:** nothing. **Implements:** ADR-159-2 D1–D6, least-privilege clause
([AFC-159](/AFC/issues/AFC-159))
**Origin:** [AFC-173](/AFC/issues/AFC-173). **Affects:**
`services/directus/schema/migrations/20261006_0004_retention.sql`,
`scripts/run-db-tests.mjs`

---

## Decision

**A migration may `GRANT` and `REVOKE`. It may never `CREATE ROLE`.**

Role creation moves out of the migration sequence and into the bootstrap step
that runs as the cluster owner, before any migration is applied. A migration that
needs a role it does not find **fails closed** with a message naming the bootstrap
step, rather than creating the role itself.

## Context

`20261006_0001_incidents.sql` creates `directus_migrator` and `directus_app`, and
documents that the migrator is "assumed via SET ROLE by the migration runner". So
the sequence is privileged for `0001` and unprivileged from `0002` onward: the
applying role is `directus_migrator`, which owns the tables and correctly holds no
`CREATEROLE`.

`20261006_0004_retention.sql` was the first migration that needed a **new** role.
It inherited the privilege `0001` had and did not have:

```
FAIL 20261006_0004_retention.sql did not apply
     permission denied to create role
     code: 42501  -- Only roles with the CREATEROLE attribute may create roles.
     where: CREATE ROLE retention_worker NOLOGIN
```

This is a harness defect, not a typo in one file. Every future migration that
introduces a role fails identically, and nothing in the suite said so until a
migration happened to need the capability.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| **Grant `CREATEROLE` to `directus_migrator`** | **Load-bearing rejection.** In PostgreSQL 16, `CREATEROLE` permits granting membership in *any* non-superuser role. The migration identity could promote itself to `directus_app` — or to any role created later — and escalate to full read/write on the application database. It converts the least-privilege model `0001`–`0003` were built on into a fiction **while making the suite green**. A green gate bought by weakening the boundary is a worse outcome than a red gate. |
| Grant `CREATEROLE` only for the duration of `0004` | Not expressible in PostgreSQL: role attributes are cluster-level and there is no scoped grant. The blast radius is the same. |
| Keep `CREATE ROLE` in migrations, accept that the sequence runs privileged | That is the current state of `0001`. It means every future migration runs with cluster-level authority, and the split between "table owner" and "cluster owner" is invisible in the deploy path. The privilege boundary becomes a comment. |
| Provision roles inside a migration run as a superuser | Reintroduces exactly the "migrations are privileged" model. Roles-as-infrastructure is the fix; re-homing `CREATE ROLE` one directory over is not. |
| **Bootstrap roles outside the sequence; migrations only `GRANT`/`REVOKE`** (**chosen**) | Matches how `directus_app` is meant to be provisioned in a real Directus deployment. Preserves the least-privilege model. The failure mode becomes a named, deliberate wall instead of a privilege error discovered at deploy time. |

## Consequences

**Accepted costs**

- Bootstrap is a real deploy step with its own ordering. It must run as the cluster
  owner, before migrations, on every environment including a fresh database. That
  is one step the migrations no longer do for themselves.
- A migration that introduces a role will fail on a fresh database until bootstrap
  is updated. That is the intended failure: it is a build-order error the author
  sees immediately, not a silent grant escalation.
- `0001` still contains `CREATE ROLE` for the two bootstrap roles and is
  grandfathered. Removing it means editing already-applied schema history, which
  is a one-way door on an evidence surface. Tracked, not done, in AFC-173.

**What this buys**

The privilege boundary becomes mechanical. `CREATE ROLE` appearing anywhere under
`services/directus/schema/migrations/` is now a **class** defect with a single
definition, not a per-file judgement call — and it is checkable statically.

## The rule, in one line

> Roles are infrastructure. Migrations are history. A migration that needs a new
> identity asks the operator for one; it does not mint one.

---

# Part 2 — CTO review of the untracked retention substrate

Recorded here rather than in an issue comment because it is the artifact of record
for the review AFC-173 requires. Reviewed against ADR-159-2 D1–D6.

**Provenance:** both files appeared in the shared workspace with no issue, no
author, and no review. `20261006_0004_retention.sql` and
`engine/0001_retention_engine.sql` were written at 02:17 on 2026-10-06 and were
`??` untracked. They were reviewed because they were about to be committed, not
because the process asked for it.

## D1–D6 assessment

| Decision | Status | Note |
| --- | --- | --- |
| **D1** no retention period in code | **Holds** | Every duration is read from `retention_policies`. `retention.add_years` builds the interval from the configured integer. The literal gate scans the engine and not the migrations, which is the right split and is the reason the engine is not under `migrations/`. |
| **D2** config-driven schedule | **Holds** | `UNIQUE(rule_key, version)` plus a partial unique index on `WHERE is_active`. Supersede is `version + 1` + `supersedes_id`; "what rule was in force when we deleted this?" is answerable. |
| **D3** per-category, never per-person | **Holds** | `UNIQUE(person_id, retention_class)` makes the shape structural. The person row is never an erasure target. |
| **D4** legal hold outranks everything | **Holds in ordering, unproven in execution** | The check order (hold → ladder → due → enabled) is correct and hold is re-read at erasure time. But see **F1**: the live path never reaches erasure, so the ordering is asserted only against dry runs. |
| **D5** terminal ladder | **Holds** | Ladder comes from the policy row; `ladder_reached` fails closed to "not reached". |
| **D6** ships dark | **Holds** | `delete_enabled boolean NOT NULL DEFAULT false`, no policy rows seeded, `retention_class_sources` empty. Correct posture given the schedule is unratified. |

**Design quality is genuinely high.** Config-driven anchors and erasure targets,
fail-closed state derivation, write-time hold-scope resolution, a manifest for every
examined clock, append-only run items, and metrics exported next to the deletion
counts so a silently-stopped job cannot report itself compliant. This is not
code that should be thrown away.

**It is also code that was never run.** That is the finding that matters.

## Defects found

All three were **proven by execution** against PostgreSQL 16 (PGlite), not inferred
by reading.

### F1 — CRITICAL. The live erasure path does not execute.

`retention.run()` at `engine/0001_retention_engine.sql:407-414` runs:

```sql
FOR v_erased IN
  EXECUTE format('WITH gone AS (DELETE FROM public.%I WHERE %I = $1 RETURNING 1)
                  SELECT count(*) AS n FROM gone', rcs.table_name, rcs.person_column)
  USING c.person_id
LOOP NULL; END LOOP;
```

`rcs` is **never declared** in the function's `DECLARE` block and is never
assigned. There is no loop over `retention_class_sources` anywhere in `retention.run`.
The `FOR` target is a phantom record.

Proven:

```
FAIL worker -> run(live) :: missing FROM-clause entry for table "rcs" [42P01]
     medical_records rows remaining: 1
```

The single most destructive function in the system raises on the only branch that
actually erases. Every D6 dry run passes; the live path has never worked.

**It fails closed, which is the saving grace** — the run aborts and nothing is
deleted. But a retention engine that cannot erase is not shippable, and nothing in
the suite caught it because every suite exercises `dry_run`.

**Fix:** iterate `retention_class_sources` filtered by `c.retention_class` and
record the per-table count in the manifest.

### F2 — CRITICAL. `retention_worker` cannot execute the engine it is the sole caller of.

The grants block revokes `EXECUTE` from `PUBLIC` on the helper functions and grants
`EXECUTE` on only `retention.run` and `retention.sync_clocks` to `retention_worker`.
But `sync_clocks` is **not** `SECURITY DEFINER` (line 200-202), so its internal
calls to `resolve_anchor`, `compute_due_date` and `has_active_hold` are permission
checked **as the worker**, and the worker holds none of them.

Proven:

```
FAIL worker -> sync_clocks()      :: permission denied for function resolve_anchor [42501]
FAIL worker -> has_active_hold()  :: permission denied for function has_active_hold [42501]
FAIL worker -> compute_due_date() :: permission denied for function compute_due_date [42501]
FAIL worker -> resolve_anchor()   :: permission denied for function resolve_anchor [42501]
OK   worker -> run(dry_run)       [works: run() is SECURITY DEFINER]
```

The identity that exists **solely** to run retention cannot run retention. This is
the same defect as F1 wearing a different hat: the documented production path —
bootstrap, migrate, then `retention_worker` executes — fails closed at step three.
The suite is green because no test calls `sync_clocks` as `retention_worker`.

**Fix:** either make `sync_clocks` `SECURITY DEFINER` with a pinned `search_path`
(the shape `retention.run` already uses, and the correct one), or grant the worker
`EXECUTE` on the four helpers. The `SECURITY DEFINER` route is preferred: it keeps
the worker's grant surface to exactly the two entrypoints the design intends.

### F3 — the substrate has never been executed, which is how F1 and F2 survived.

`engine/0001_retention_engine.sql` (575 lines) and `0004_retention.sql` (466 lines)
were written, committed nowhere, run by no test, and reviewed by nobody. Both F1 and
F2 sit in the one function that matters and neither is caught by 142 green
assertions, because every one of them drives `dry_run`.

**Fix:** a suite that calls `retention.run(...,'live')` end to end against a
throwaway table, as `retention_worker`, asserting rows are actually gone. Dry-run
coverage is not coverage of a deletion control.

## Verdict

**Not approved for commit.** The harness fix in this ADR is approved and is the
correct resolution of AFC-173's root cause. The substrate is well-designed and D1–D6
hold, but it carries one critical defect that makes its primary function inoperable
and a second that makes its only production caller unable to invoke it. Both are
fail-closed, so the risk is a non-functional control rather than data loss — but a
control that cannot act is not evidence of compliance, and shipping it green would
mean the compliance argument rests on a function that has never run.

The substrate stays untracked until F1, F2 and F3 are fixed and reviewed against
this ADR.

**Reviewers notified:** CEO ([Operations](/AFC/agents/operations)) for the
provenance gap; SecurityEngineer seat does not exist yet
([AFC-168](/AFC/issues/AFC-168)) — this review is CTO-only for that reason, which is
itself a standing gap.