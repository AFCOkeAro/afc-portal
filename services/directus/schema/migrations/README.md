# Directus schema migrations

Plain SQL, applied in filename order, each file one transaction. No framework —
the schema is a legal-evidence surface, so the applied statements should be
readable in a diff rather than generated.

## Order

| File | What it does |
| --- | --- |
| `20261006_0001_incidents.sql` | The `incidents` register, the role split, the column-level grants, **and the evidence seal** (`incidents_no_delete` / `incidents_no_truncate`). The seal is owned here because "incidents rows are never deleted" is a property of the register and predates `awareness_at`. See [ADR-0003](/AFC/issues/AFC-253#document-adr). |
| `20261006_0002_incidents_awareness_at.sql` | The NDPA s.40(2) clock origin: columns, defaults, backfill, the two **clock** guards (`incidents_immutable_awareness` / `incidents_no_caller_clock`), the ordering constraint, and the clock view. It also **re-asserts `0001`'s two evidence guards** verbatim, so a database whose `0001` predates that change is repaired rather than stranded by a partial deploy. It does not own them. |
| `20261006_0003_incidents_awareness_field_policy.sql` | Strips `awareness_at` from every Directus create/update policy, including super admin. Second layer only — see [ADR-0001](/AFC/issues/AFC-166). |
| `20261006_0004_retention.sql` | The retention and legal-hold substrate: `people` (the retention anchor only), the two source maps, `retention_policies`, `retention_clocks`, `legal_holds`, `retention_runs`, `retention_run_items`, the F1/F2/F3 constraints, and the ownership triggers. **Ships with no policy rows** — the schedule is board-ratified and counsel is confirming it. |
| `rollback/20261006_0001_incidents.down.sql` | Reversal for 0001, and **the only path that removes the evidence seal**. **Refuses to run while the register holds any row.** |
| `rollback/20261006_0002_incidents_awareness_at.down.sql` | Reversal for 0002. Drops the clock objects and both awareness columns, then **re-asserts the evidence seal**, so it cannot end in an unsealed register. |
| `rollback/20261006_0004_retention.down.sql` | Reversal for 0004. **Refuses to run while a legal hold is active or any clock is recorded as erased**, because it would destroy exactly the evidence those two things exist to preserve. Verified in all three directions: refused with a hold, refused with an erased clock, clean when neither. |

`0001` and `0002` are separate on purpose: the backfill in `0002` has to cope with
rows that predate the clock origin, and that is only true if the register existed
before `awareness_at` did.

## Who owns the evidence seal

`0001` owns it. `incidents_forbid_delete()` and `incidents_forbid_truncate()` read
no column and belong to no migration that added one — they enforce the rule
`0001`'s own `COMMENT ON TABLE` already states, that rows are evidence and are
never deleted. `0002` re-asserts them idempotently; that is a repair path for
already-deployed databases, not a second owner.

This layering is the fix for a defect that survived two reviews
([AFC-253](/AFC/issues/AFC-253), found by SecurityEngineer in the R2 review of
`1f43c9e`). While the guards lived only in `0002`, `0002`'s down script dropped
them with the clock objects, so reversing the clock migration disarmed the
register: `DELETE` and `TRUNCATE` both succeeded afterwards for the table owner
and for any session holding table-level `DELETE` and `TRUNCATE` — which is what
`20_immutability.sql` grants every v4 role. `directus_app` still saw `42501`,
because the grant layer survives independently, so a check on that identity alone
read green over an open register. Assert the owner and a fully-granted role, never
`directus_app` by itself.

## The engine is not a migration

`services/directus/schema/engine/` holds the retention engine, applied after the
migrations and outside this directory. Two reasons, both load-bearing:

1. The retention-literal gate exempts `migrations/**` so a migration can state
   the period it was created with, and scans everything else — including
   `.sql`. Putting the code that computes a due date in the exempt directory
   would make the gate a green tick over an unenforced rule. **The engine is
   exempt from nothing and contains no duration.**
2. The engine is behaviour, not schema history. Every engine fix would otherwise
   consume a migration number and the history would stop being readable.

`retention_worker` and the `retention` schema are **bootstrap** objects, created
by `services/directus/schema/bootstrap/0001_roles.sql` — see
[ADR-0002](/AFC/issues/AFC-173). A migration may GRANT and REVOKE; it may never
CREATE ROLE.

## Running them

Bootstrap runs once as the **cluster owner**. Migrations run as
**`directus_migrator`**, which owns every table. Directus connects as
**`directus_app`**, which owns nothing. The retention job runs as
**`retention_worker`**, which owns nothing and holds no DELETE.

```
psql "$CLUSTER_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f services/directus/schema/bootstrap/0001_roles.sql

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f services/directus/schema/migrations/20261006_0001_incidents.sql \
     -f services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql \
     -f services/directus/schema/migrations/20261006_0003_incidents_awareness_field_policy.sql \
     -f services/directus/schema/migrations/20261006_0004_retention.sql

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f services/directus/schema/engine/0001_retention_engine.sql
```

Do not run them as `directus_app`. If the two roles are the same, the guard trigger
becomes one `ALTER TABLE ... DISABLE TRIGGER` away from gone, and no test will tell
you — the tests only prove the split when the split exists.

## Re-running

`0002` is idempotent. `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, the backfill
guarded by `WHERE awareness_at IS NULL` (zero rows after the first run, because the
column is `NOT NULL`), and `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`. The
backfill-survival suite re-runs the whole file and asserts every clock origin is
byte-identical afterwards.

`ALTER TABLE ... DISABLE TRIGGER` is **not** used anywhere in the migration path. It
requires table ownership, and a deploy step that needs ownership is a privileged step
waiting for a reason. If you ever need it, it belongs in a reviewed maintenance
script under `services/directus/backup/`, never in the migration.

## Rollback

`rollback/20261006_0002_incidents_awareness_at.down.sql` — `DROP TRIGGER`, `DROP FUNCTION`,
`DROP COLUMN` for the clock objects and both awareness columns, then a **re-assert of
`0001`'s evidence seal** and a `RAISE NOTICE` saying so. It is re-runnable.

**The reversal leaves the register sealed.** That is the point: reversing the clock
migration must not open the breach register, and it used to. Its header now names
every object it removes, because the previous header — "Additive only; nothing is
destroyed" — is the reason nobody saw the defect.

`rollback/20261006_0001_incidents.down.sql` is the **only** path that removes the
evidence seal, and it **refuses while the register holds any row** with a
`restrict_violation` naming the count. An NDPA s.40(2) register has no drop path
while it holds evidence: the file drops the two guards and the table on an empty
register, and on a non-empty one it tells the operator to take a verified copy and
record where it went. There is no session flag gating any of this
([ADR-0003](/AFC/issues/AFC-253), Alternative C) — a reversal path that has to be
unlocked is a deploy with no rollback path.

Note what `0002`'s reversal *does* destroy: the recorded clock origins. Run it only if
the migration itself is being abandoned. The correct action for a wrong `awareness_at`
value is a new incident row referencing the original.

## Tests

```
pnpm test:db                                  # local, no services required
PG_URL=postgres://… pnpm test:db              # against a real instance (CI)
```

`scripts/run-db-tests.mjs` boots the role split the same way production has to be
bootstrapped, applies the migrations as the owner, then runs `tests/db/*.sql`.
`tests/db/40_clock.sql` and `30_backfill_survival.sql` use `\i` to include a
migration against a throwaway schema; the runner expands that, and the files still
run under `psql` unchanged.

**Do not create a database for the runner and point it there.** With `PG_URL` set it
creates its own — an `afc_dbtest_scratch_*` database — migrates that, and drops it on
the way out. The database named in `PG_URL` is never opened, which matters because
`DATABASE_URL` on some hosts is a live application database. The role in `PG_URL`
needs `CREATEDB`; without it the runner refuses rather than falling back to migrating
in place, and it prints the guarantee it is operating under in its first lines. See
`scripts/lib/scratch-db.mjs`.