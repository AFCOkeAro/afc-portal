# Role bootstrap

**These are roles, not migrations.** They are provisioned here, by the cluster
owner, *before* the migration sequence runs. Nothing under
`services/directus/schema/migrations/` may create or escalate a role.

Enforced by `scripts/migration-privilege-gate.sh`, which fails the build on any
`CREATE ROLE`, `CREATE USER`, `GRANT CREATEROLE` or `ALTER ROLE ... SUPERUSER`
under `migrations/`. Rationale and rejected alternatives: [ADR-0002](/AFC/issues/AFC-173).

## Why the split exists

Migrations run as `directus_migrator`, which owns the tables it creates and
correctly holds no `CREATEROLE`. A migration that could mint roles would need
`CREATEROLE` — and in PostgreSQL 16 that attribute permits granting membership in
*any* non-superuser role, so the migration identity could promote itself to
`directus_app` and escalate to full read/write on the application database.

That is the whole reason this directory exists: the suite would go green and the
least-privilege model would become a fiction.

## Order

1. **Bootstrap roles** — this directory. Runs as the cluster owner.
2. **Migrations** — `services/directus/schema/migrations/`, in filename order, as
   `directus_migrator`. `GRANT`/`REVOKE` only.
3. **Engine** — `services/directus/schema/engine/`, as `directus_migrator`.

## Which roles

| Role | Login | Purpose |
| --- | --- | --- |
| `directus_migrator` | no | Owns every table. Assumed via `SET ROLE` by the migration runner. Never authenticates as itself. Holds **no** `CREATEROLE`. |
| `directus_app` | yes | The single identity Directus uses for every API role. Owns nothing. |
| `retention_worker` | no | The only identity that may execute an erasure. Holds no `DELETE` grant of its own — it reaches erasure only through `retention.run()`, which re-checks the legal hold at the moment of erasure. |

`retention_worker` is `NOLOGIN` on purpose: it is granted to whatever service
account the retention scheduler runs as, so the executor identity is an
infrastructure decision rather than something baked into the schema.

## Running it

```
psql "$CLUSTER_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f services/directus/schema/bootstrap/0001_roles.sql
```

`CLUSTER_ADMIN_DATABASE_URL` must be a connection that **can** create roles. This
is the only step in the deploy path that requires cluster-level authority, and it
is a step rather than a migration precisely so that its privilege is visible.

The script is idempotent: re-running it is a no-op for roles that already exist.

## Failure mode

If bootstrap is skipped, migrations fail closed with a named error rather than a
bare `42501`:

```
bootstrap role(s) retention_worker are missing. They are provisioned by the
cluster-owner bootstrap step BEFORE the migration sequence (ADR-0002), not by a
migration: migrations run as directus_migrator, which holds no CREATEROLE.
```