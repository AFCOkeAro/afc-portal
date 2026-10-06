# ADR-0001 — `incidents.awareness_at` is enforced by the database

**Status:** Accepted (implementation), CTO self-reviewed 2026-10-06 — second review
pending the SecurityEngineer seat ([AFC-166](/AFC/issues/AFC-166),
[AFC-168](/AFC/issues/AFC-168))
**Supersedes:** nothing. **Implements:** ADR-159-2 D7 ([AFC-159](/AFC/issues/AFC-159))
**Affects:** `services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql`

---

## Decision

The NDPA s.40(2) notification clock starts when the church becomes aware, not when
engineering detects the breach. That origin (`incidents.awareness_at`) is **set by
the database and is immutable afterwards**, enforced by a `BEFORE UPDATE` trigger
and a `BEFORE INSERT` trigger. Directus field permissions and column-level grants
exist as a second layer and are explicitly not the control.

## Context

`data-model-v4.md` §5 gives super admin CRUD on every collection, and Directus
holds **one** database credential for **every** API role. A Flow `exec` operation,
a Studio operator, or a `psql` session as that credential all reach the table
through the same connection and bypass the role layer entirely. So any control
expressed as a permission can be widened by a config change, a support action, or a
migration, and the compliance argument dies on a technicality we built ourselves.

A control that cannot be evidenced is not a control. NDPC will ask when the church
became aware; we have to be able to show that the answer was not chosen by anyone.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Directus field-level permissions only (read-only field) | Answers the wrong question. It is the second defence, not the control. Super admin has CRUD on every collection, so this configuration is one policy edit away from gone. |
| Application discipline — the Nuxt form does not send the field | A comment, not a control. Every other write path (Flow, Studio, SQL, a future service) skips it. |
| A Directus Flow that stamps the field on create | Flows run as the runtime credential, which owns nothing; and the flow is editable in Studio by exactly the operators we are defending against. |
| Application middleware / a `server/` route guard | Guards one entry point out of many, and the middleware is the code most likely to be refactored away without a test that fails. |
| **Postgres trigger** (**chosen**) | Enforced for every identity including the table owner, in one place, with a rollback path. Cannot be bypassed without table ownership, which the runtime credential does not have. |

## Consequences

**Accepted costs**

- Every write to those two columns now raises `restrict_violation` (23001), for
  every identity. That is the point, but it means support tooling that patches rows
  generically will break, and that has to be documented rather than discovered.
- A wrong `awareness_at` is **not correctable**. The remediation is a new incident
  row referencing the original, which keeps both records. This is deliberate: an
  editable clock origin is an unprovable clock origin.
- A register import cannot use plain `INSERT`. It goes through the migration
  backfill, which records provenance as inferred. Otherwise an import could assert
  its own clock origins and the provenance record would mean nothing.
- Every Directus role authenticates as one database credential, so per-role
  database enforcement of this field is not expressible. The trigger is what makes
  that irrelevant.

## Decisions inside the decision

**1. `IS DISTINCT FROM`, not `<>`.** An `UPDATE` that leaves the value alone is
legitimate — Directus sends only the fields in the patch. Rejecting a no-op change
would teach operators to disable the trigger, and then the control is gone for
real. Tested (`re-stating awareness_at with its own value is not a change`).

**2. No `DISABLE TRIGGER` in the deploy path.** The brief prescribed
`DISABLE TRIGGER` around the backfill because the `BEFORE UPDATE` trigger blocks
its own backfill. The backfill is instead guarded by `WHERE awareness_at IS NULL`,
which matches zero rows on a re-run because the column is `NOT NULL` afterwards.
The trigger is created last, so first-run ordering is safe on its own. Net effect:
one fewer privileged, ownership-requiring step in a production migration
(security lens). Verified by the backfill-survival suite, which re-runs the whole
migration and asserts byte-identical values.

**3. No `CHECK (detected_at <= awareness_at)`.** Staff can tell the board before
engineering notices, so the ordering is not guaranteed by reality. A constraint
there would force operators to fudge one of the two fields, which is worse than
the ambiguity it removes. Only `reported_at >= awareness_at` is ordered, because
that one is ordered by definition.

**4. `TRUNCATE` gets its own statement trigger.** Row-level `BEFORE DELETE`
triggers do not fire on `TRUNCATE`, so without a statement-level guard
`TRUNCATE incidents` is a complete register wipe with no error. Found while
writing the tests; it is not in the brief and it is a hole in the brief.

**5. A `BEFORE INSERT` guard as well.** The brief relied on column-level grants to
stop callers supplying `awareness_at`. Column-level grants cannot restrict the
table owner, which holds every privilege on its own table — so the owner could
file an incident with a backdated clock origin. The insert guard closes it by
comparing against `now()`, which is exact: the default is `now()` and `now()` is
stable for the transaction, so the value differs from the default if and only if a
caller supplied it. Found by the test suite, which failed on exactly this case.

**6. Credential split: `directus_migrator` owns, `directus_app` runs.** Migrations
run as the owner; Directus connects as a role that owns nothing. `ALTER TABLE ...
DISABLE TRIGGER` requires table ownership, so with this split the runtime
credential cannot switch the control off. Without the split, it could. Asserted in
the suite.

**7. `awareness_at_source` is deliberately not an enum.** Provenance is evidence,
and the set of honest answers is open — a future `import:legacy_register` is
plausible. Constraining it to today's two values would make a regulator's vocabulary
a release dependency.

## Residual risk, stated rather than assumed

The **table owner** can disable the trigger and then backdate a clock origin. This
is asserted as a test (`documented residual risk: the table owner can disable the
guard and then backdate awareness_at`) rather than assumed away. A PostgreSQL
superuser can do the same.

Compensating controls: the credential split (the runtime role is not the owner),
the rotation and audit of the migration credential, the CI suite re-asserting the
control on every migration, and `awareness_at_source` making an inferred value
visibly inferred. Closing this completely would mean an external append-only log
or a separate trust boundary, which is disproportionate at this scale and is a
board conversation, not a code change.

## Verification

`pnpm test:db` — 5 suites, 108 assertions, PostgreSQL 16.4. The immutability suite
covers all seven roles in the v4 matrix plus a role granted `ALL` on the table, and
asserts `23001` for each. Mutation-checked: removing the trigger takes the run from
108 assertions passing to 3 suites failing.

## Review status

CTO self-review, 2026-10-06, as the conscious degradation agreed with the CEO while
the SecurityEngineer seat is with the board. `repo-plan` §3 requires a second
reviewer on data migrations; CTO self-review satisfies the letter of it and not its
intent. **A SecurityEngineer must review this migration before it is applied to any
non-development database.** Until then this ADR is the compensating control.