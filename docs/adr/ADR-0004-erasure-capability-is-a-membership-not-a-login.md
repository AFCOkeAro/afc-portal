# ADR-0004 — The erasure capability is a membership, not a login

**Status:** Accepted (decision), CTO 2026-10-06. Implementation: AFC-205.
**Supersedes:** nothing. **Extends:** [ADR-0002](ADR-0002-roles-are-bootstrap-not-migrations.md)
**Origin:** [AFC-205](/AFC/issues/AFC-205), which re-opened ADR-0002 Part 2 finding
F1's grant surface from the membership layer. **Affects:**
`services/directus/schema/bootstrap/0001_roles.sql`, `scripts/run-db-tests.mjs`,
`tests/db/`

---

## Decision

**Four roles. The erasure capability is a `NOLOGIN` role held by exactly one named
`LOGIN` identity through membership, and the membership is provisioned in bootstrap
and asserted there.**

| Role | Attribute | Holds |
| --- | --- | --- |
| `directus_migrator` | `NOLOGIN` | owns every table; `SECURITY DEFINER` owner of the engine |
| `directus_app` | `LOGIN` | the one identity Directus connects as |
| `retention_worker` | `NOLOGIN` | `EXECUTE` on `retention.run` + `retention.sync_clocks`, and nothing else |
| `retention_job` | `LOGIN` | **membership in `retention_worker`, and nothing else** |

1. `retention_job` is created by bootstrap as `LOGIN` with **no password set in the
   repository**. Credentials are provisioned out of band, like `directus_app`'s.
2. Bootstrap runs `GRANT retention_worker TO retention_job`. The role stays
   `NOLOGIN`; **the membership is the capability, the login is the identity.**
3. Bootstrap's existing boundary assertion gains one clause: **exactly one**
   `rolcanlogin` role may be a member of `retention_worker`. `0` fails the deploy
   because the control cannot be run by anyone; `>1` fails it because the erasure
   surface is wider than the single identity it is designed around.
4. `directus_app` gains nothing: no `EXECUTE` on `retention.run`, no membership in
   `retention_worker`.
5. Neither `retention_worker` nor `retention_job` receives `DELETE` on any
   collection. Erasure happens only inside `SECURITY DEFINER`, as the owner.
6. The test fixture applies **the real bootstrap file**, not a copy of it.

## Context

`retention_worker` was created `NOLOGIN` and granted to nothing. There is no
`GRANT retention_worker TO` anywhere in the tree. So the sole erasure executor had
no holder: the only identities that could execute `retention.run` were
`directus_migrator` (also `NOLOGIN`, and the `SECURITY DEFINER` owner) and a cluster
superuser. Neither is a production login. **In the deployed configuration,
`retention.run(p_actor, 'live', now())` cannot be called by anyone.**

[AFC-193](/AFC/issues/AFC-193) fixed a different defect at a different layer — the
worker's `EXECUTE` ACL was insufficient for the helpers the engine calls
internally. Fixing that changed what the worker *can do* once it is reached. It did
nothing about whether anything can *reach* it.

The test suite could not see the gap, and the reason is structural rather than an
oversight. `tests/db/assert.sql:109` implements `as_role()` as
`EXECUTE 'SET LOCAL ROLE ' || …` from a session role captured at `assert.sql:41`.
Under PGlite that session is a superuser, and a superuser may `SET ROLE` to any
role regardless of membership. The suite therefore proves the ACL is *sufficient*
and is structurally unable to prove that any non-superuser can *obtain* it.

The failure mode this admits is the one that hurts: a scheduler wired up against
this tree fails with `permission denied for function run`, runs never again, and the
only evidence is a stale `retention_last_run_at` in `retention_metrics`. A retention
job that silently stops is the unbounded-liability case that view exists to catch.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **Grant `retention_worker` to `directus_app`** | **Load-bearing rejection.** `directus_app` is the broad application identity. Granting it the capability turns any application-side compromise into data-erasure capability and makes `has_function_privilege('directus_app', 'retention.run')` true, which is exactly the boundary AFC-193 exists to hold. The job and the application do not share a trust level. |
| **Make `retention_worker` itself `LOGIN`** | Rejected. It merges the identity into the capability, so the login is now as sensitive as the grant surface and any future attribute widened on the role widens the login too. It also fails AFC-205's third acceptance criterion outright. |
| **Grant `retention_worker` to more than one `LOGIN` role** | Rejected. It multiplies the number of credentials that can erase without any operational gain. Two holders of live-erasure capability is strictly worse than one, and it removes the ability to answer "who can delete a record?" with a single name. |
| **Have the job connect as `directus_migrator` and `SET ROLE`** | Rejected. `directus_migrator` is `NOLOGIN` and is the `SECURITY DEFINER` owner of every engine function; giving it a login makes it a credential that can own and drop every table in the application database. |
| **Create the `LOGIN` identity in a migration** | Rejected. ADR-0002 Part 1: a migration may `GRANT`/`REVOKE`, never `CREATE ROLE`. |
| **Set the job's password in the bootstrap file** | Rejected without exception. Bootstrap must stay free of secrets so the file is committable and diffable; credentials are provisioned out of band. |
| **Named `LOGIN` identity granted the membership** (**chosen**) | One credential, one job, one named owner of the most destructive function in the system. Membership is provisioned and asserted in the one step whose privilege is visible. |

## Consequences

**Accepted costs**

- A fourth identity exists and needs real operational care. `retention_job` is now
  a credential with erase power: it belongs in the secret inventory, in the
  credential-rotation policy, and in the periodic access review. A credential that
  can delete records is not a credential whose scope can be forgotten.
- Bootstrap gains a fail-fast assertion. A deploy that mis-provisions the identity
  now **stops at bootstrap** instead of producing a job that never runs. That is the
  intended outcome: a named wall beats a silent operational failure.
- The role name is now public contract. Renaming `retention_job` is a migration of
  deployed credentials, not a code edit.

**What this buys**

- The erasure path becomes reachable by exactly one identity, and the reachability
  is asserted structurally (membership) *and* behaviourally (a non-superuser
  session that obtains the role by membership).
- The test suite stops asserting a fiction. Applying the real bootstrap file means
  the fixture is the deployed configuration, which is the whole claim the suite is
  for.

## The test, and why it cannot pass vacuously

The membership assertion has to be reached **without** superuser override, or it
reproduces the exact blind spot it is written to close. The technique is
`SET SESSION AUTHORIZATION retention_job` (drops superuser) followed by
`SET LOCAL ROLE retention_worker` inside a discarded subtransaction, with the result
captured into a plpgsql variable.

Proven against PostgreSQL 16 (PGlite) before the decision was written, not inferred:

```
retention_job  -> retention_worker    ALLOWED  current_user=retention_worker
retention_job  -> other_app           DENIED   42501
other_app      -> retention_worker    DENIED   42501
```

The two `DENIED` rows are the point. Without them the technique would pass on any
PostgreSQL where `SET ROLE` was somehow unrestricted, and would go green for the
wrong reason — the same class of defect AFC-202 found in the timestamp assertions.

## Reviewers

- **CTO** ([MediaTech](/AFC/agents/mediatech)) — decision of record, and implementer
  of the bootstrap change. Approved: architecture, least privilege, test strategy.
- **SecurityEngineer** ([securityengineer](/AFC/agents/securityengineer)) —
  independent security review of the change, against ADR-0002 Part 2 and this ADR.

The seat referred to in ADR-0002 Part 2 and in AFC-205's escalation as *not existing*
was created 2026-10-06 and [AFC-165](/AFC/issues/AFC-165) is closed. **The recorded
degradation in AFC-205 — "reviewer resolves to a CTO review, which is a recorded
degradation, not independent review" — is superseded.** Independent review is
available and is scheduled. The CTO is still the approver, because this change
touches auth and permissions and that decision is the CTO's to own; but the
approver is no longer also the only reviewer.

## The rule, in one line

> An identity is not a capability. The login is who connects; the role is what it
> may destroy. Keep them separate, name the holder, and assert in the same step
> that provisions it that there is exactly one.